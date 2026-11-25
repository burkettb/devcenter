import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { DevCenterStandards } from "../src/types";
import { appRoot, expandTilde, resolveDevCenterHome } from "./home";

export { expandTilde } from "./home";

interface ConfigFile {
  scanRoot?: string;
  maxDepth?: number;
  port?: number;
  excludeSubdirectories?: string[];
}

export interface RuntimeConfig {
  scanRoot: string;
  maxDepth: number;
  port: number;
  excludeSubdirectories: string[];
}

export const defaultStandards: DevCenterStandards = {
  branch_naming: {
    feature: "feature/{slug}",
    fix: "fix/{slug}",
    chore: "chore/{slug}",
    experiment: "experiment/{slug}"
  },
  required_files: ["README.md"],
  task_statuses: ["inbox", "backlog", "next", "in_progress", "blocked", "done"],
  preferred_license: "none"
};

async function readOptionalYaml(filePath: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return YAML.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function readOptionalJson(filePath: string): Promise<ConfigFile | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as ConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function mergeStandards(base: DevCenterStandards, override: unknown): DevCenterStandards {
  if (!isObject(override)) {
    return base;
  }

  const overrideBranchNaming: Record<string, string> = {};
  if (isObject(override.branch_naming)) {
    for (const [key, value] of Object.entries(override.branch_naming)) {
      if (typeof value === "string") {
        overrideBranchNaming[key] = value;
      }
    }
  }

  const branchNaming = isObject(override.branch_naming)
    ? {
        ...base.branch_naming,
        ...overrideBranchNaming
      }
    : base.branch_naming;

  return {
    ...base,
    branch_naming: branchNaming,
    required_files: stringArray(override.required_files, base.required_files),
    task_statuses: stringArray(override.task_statuses, base.task_statuses) as DevCenterStandards["task_statuses"],
    preferred_license: typeof override.preferred_license === "string" ? override.preferred_license : base.preferred_license
  };
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const localConfig = await readOptionalJson(path.resolve(process.cwd(), "devcenter.config.json"));
  const scanRoot = process.env.DEV_CENTER_ROOT ?? localConfig?.scanRoot ?? "~/dev";
  const port = Number(process.env.PORT ?? localConfig?.port ?? 4173);
  const maxDepth = Number(process.env.DEV_CENTER_MAX_DEPTH ?? localConfig?.maxDepth ?? 3);
  const excludeSubdirectories =
    process.env.DEV_CENTER_EXCLUDE?.split(",").map((item) => item.trim()).filter(Boolean) ??
    localConfig?.excludeSubdirectories ??
    [];

  return {
    scanRoot: path.resolve(expandTilde(scanRoot)),
    maxDepth: Number.isFinite(maxDepth) ? maxDepth : 3,
    port: Number.isFinite(port) ? port : 4173,
    excludeSubdirectories
  };
}

export async function loadStandards(): Promise<DevCenterStandards> {
  // Same layering as the sidecar snapshots: built-in defaults from the app repo,
  // then the environment overlay from the DevCenter home (memory repo).
  const { home } = await resolveDevCenterHome();
  const defaults = await readOptionalYaml(path.join(appRoot(), "standards", "defaults.yaml"));
  const overlay = await readOptionalYaml(path.join(home, "standards", "global.yaml"));
  return mergeStandards(mergeStandards(defaultStandards, defaults), overlay);
}
