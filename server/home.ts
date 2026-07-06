import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The DevCenter "home" is the private memory repo (projects/*, standards/global.yaml).
// It is deliberately separate from the app root so the app repo can be public and one
// install can serve different homes on different machines (personal vs work).
export type HomeSource = "env" | "config" | "repo";

export interface HomeResolution {
  home: string;
  source: HomeSource;
}

export function expandTilde(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

// The repo the devcenter code lives in; standards/defaults.yaml ships here.
export function appRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function homeConfigPath(): string {
  return process.env.DEVCENTER_CONFIG ?? path.join(os.homedir(), ".devcenter", "config.json");
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function readConfiguredHome(): Promise<string | undefined> {
  const raw = await readTextIfExists(homeConfigPath());
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as { home?: unknown };
    return typeof parsed.home === "string" && parsed.home.trim() ? parsed.home.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function writeConfiguredHome(home: string): Promise<string> {
  const configPath = homeConfigPath();
  const raw = await readTextIfExists(configPath);
  let existing: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // Unreadable config gets replaced rather than blocking setup.
    }
  }

  existing.home = path.resolve(expandTilde(home));
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  return configPath;
}

async function gitTopLevel(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    const output = stdout.trim();
    return output ? path.resolve(output) : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveDevCenterHome(): Promise<HomeResolution> {
  const env = process.env.DEVCENTER_HOME;
  if (env?.trim()) {
    return { home: path.resolve(expandTilde(env.trim())), source: "env" };
  }

  const configured = await readConfiguredHome();
  if (configured) {
    return { home: path.resolve(expandTilde(configured)), source: "config" };
  }

  // Pre-split layout: app and memory share one repo, so the repo the code lives
  // in is the home. Kept as the fallback so unconfigured checkouts keep working.
  const root = await gitTopLevel(appRoot());
  return { home: root ?? appRoot(), source: "repo" };
}
