import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { appRoot } from "./home";

const execFileAsync = promisify(execFile);

// The board runs as a per-user launchd agent so it is simply there: started at
// login, restarted if it dies, always on the same localhost port.
export const serviceLabel = "local.devcenter.board";
export const defaultBoardPort = 4173;

export interface ServiceResult {
  messages: string[];
  warnings: string[];
  exitCode: number;
}

export function servicePlistPath(homeDir = os.homedir()): string {
  return path.join(homeDir, "Library", "LaunchAgents", `${serviceLabel}.plist`);
}

export function serviceLogPath(homeDir = os.homedir()): string {
  return path.join(homeDir, "Library", "Logs", "devcenter-board.log");
}

/** The port the board listens on: devcenter.config.json in the app root, else the default. */
export async function boardPort(appDir = appRoot()): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(appDir, "devcenter.config.json"), "utf8");
    const port = Number((JSON.parse(raw) as { port?: unknown }).port);
    return Number.isInteger(port) && port > 0 ? port : defaultBoardPort;
  } catch {
    return defaultBoardPort;
  }
}

export function boardUrl(port: number): string {
  return `http://localhost:${port}`;
}

/** True when the board answers its health check within the timeout. */
export async function isBoardUp(port: number, timeoutMs = 500): Promise<boolean> {
  try {
    const response = await fetch(`${boardUrl(port)}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

/** One line for hook and status output. */
export async function boardStatusLine(appDir = appRoot()): Promise<string> {
  const port = await boardPort(appDir);
  if (await isBoardUp(port)) {
    return `DevCenter board: ${boardUrl(port)}`;
  }

  return "DevCenter board is not running. Start it with `devcenter service install`.";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export interface PlistOptions {
  nodePath: string;
  appDir: string;
  pathEnv: string;
  logFile: string;
}

export function renderServicePlist(options: PlistOptions): string {
  const args = [options.nodePath, "--import", "tsx", "server/index.ts"];
  const env: Record<string, string> = { NODE_ENV: "production", PATH: options.pathEnv };
  const argXml = args.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n");
  const envXml = Object.entries(env)
    .map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${serviceLabel}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(options.appDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(options.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.logFile)}</string>
</dict>
</plist>
`;
}

function requireMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error("devcenter service uses launchd and only runs on macOS. Start the board with `npm run preview` instead.");
  }
}

function launchDomain(): string {
  return `gui/${process.getuid?.() ?? os.userInfo().uid}`;
}

async function launchctl(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("launchctl", args);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

async function buildClient(appDir: string): Promise<void> {
  try {
    await execFileAsync("npm", ["run", "build"], { cwd: appDir, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(`npm run build failed:\n${failure.stderr || failure.stdout || String(error)}`);
  }
}

async function waitForBoard(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isBoardUp(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function startedResult(port: number, verb: string): Promise<ServiceResult> {
  const url = boardUrl(port);
  if (await waitForBoard(port, 15000)) {
    return { messages: [`${verb}; board running at ${url}`], warnings: [], exitCode: 0 };
  }

  return {
    messages: [`${verb}, but ${url} did not answer within 15s.`],
    warnings: [`Check the log: ${serviceLogPath()}`],
    exitCode: 1
  };
}

export async function installService(appDir = appRoot()): Promise<ServiceResult> {
  requireMacOS();
  await buildClient(appDir);

  const plistPath = servicePlistPath();
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.mkdir(path.dirname(serviceLogPath()), { recursive: true });
  await fs.writeFile(
    plistPath,
    renderServicePlist({
      nodePath: process.execPath,
      appDir,
      pathEnv: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
      logFile: serviceLogPath()
    }),
    "utf8"
  );

  // Reinstalling replaces any previous definition (new app path, new node).
  await launchctl(["bootout", `${launchDomain()}/${serviceLabel}`]);
  const bootstrap = await launchctl(["bootstrap", launchDomain(), plistPath]);
  if (bootstrap.code !== 0) {
    throw new Error(`launchctl bootstrap failed: ${bootstrap.stderr.trim() || bootstrap.stdout.trim()}`);
  }

  return startedResult(await boardPort(appDir), `installed ${plistPath}`);
}

export async function restartService(appDir = appRoot()): Promise<ServiceResult> {
  requireMacOS();
  if (!(await fileExists(servicePlistPath()))) {
    throw new Error("The board service is not installed. Run `devcenter service install`.");
  }

  // Rebuild so a pulled update is what comes back up.
  await buildClient(appDir);
  const kick = await launchctl(["kickstart", "-k", `${launchDomain()}/${serviceLabel}`]);
  if (kick.code !== 0) {
    throw new Error(`launchctl kickstart failed: ${kick.stderr.trim() || kick.stdout.trim()}`);
  }

  return startedResult(await boardPort(appDir), "rebuilt and restarted");
}

export async function uninstallService(): Promise<ServiceResult> {
  requireMacOS();
  const plistPath = servicePlistPath();
  await launchctl(["bootout", `${launchDomain()}/${serviceLabel}`]);
  const existed = await fileExists(plistPath);
  await fs.rm(plistPath, { force: true });
  return { messages: [existed ? `removed ${plistPath}` : "The board service was not installed."], warnings: [], exitCode: 0 };
}

export async function serviceStatus(appDir = appRoot()): Promise<ServiceResult> {
  const port = await boardPort(appDir);
  const installed = await fileExists(servicePlistPath());
  const up = await isBoardUp(port);
  const messages = [
    `service: ${installed ? `installed (${servicePlistPath()})` : "not installed"}`,
    `board: ${up ? `up at ${boardUrl(port)}` : `down (${boardUrl(port)})`}`,
    `log: ${serviceLogPath()}`
  ];
  const warnings = !up ? [installed ? "Installed but not answering; check the log." : "Run `devcenter service install`."] : [];
  return { messages, warnings, exitCode: up ? 0 : 1 };
}

export async function openBoard(appDir = appRoot()): Promise<ServiceResult> {
  const port = await boardPort(appDir);
  const url = boardUrl(port);
  if (!(await isBoardUp(port))) {
    return { messages: [], warnings: [`The board is not running at ${url}. Run \`devcenter service install\`.`], exitCode: 1 };
  }

  await execFileAsync("open", [url]);
  return { messages: [`opened ${url}`], warnings: [], exitCode: 0 };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
