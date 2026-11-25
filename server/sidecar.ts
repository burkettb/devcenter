import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";
import { resolveDevCenterHome } from "./home";
import { materializeGlobalStandards } from "./standards";

const execFileAsync = promisify(execFile);

const sidecarFiles = [
  "project.yaml",
  "context.md",
  "tasks.yaml",
  "decisions.md",
  "agent-log.md",
  "standards.yaml"
] as const;

const localMemoryPaths = ["AGENTS.md", ".devcenter"] as const;

// CLAUDE.md is link-only: attach points it at the sidecar AGENTS.md so Claude Code
// reads the same instructions as Codex, but existing real files are never absorbed.
const claudeLocalName = "CLAUDE.md";
const globalStandardsRelative = path.join("standards", "global.yaml");

export interface SidecarResult {
  projectName: string;
  projectPath: string;
  storagePath: string;
  messages: string[];
  warnings: string[];
  exitCode: number;
}

export interface SidecarStatus extends SidecarResult {
  agents: LinkStatus;
  claude: LinkStatus;
  devcenter: LinkStatus;
  projectTracked: string[];
  excludeEntries: Record<(typeof localMemoryPaths)[number], boolean>;
  ignoredPaths: Record<(typeof localMemoryPaths)[number], boolean>;
  sidecarDirty: boolean;
  sidecarChanges: string[];
}

export interface LinkStatus {
  localPath: string;
  expectedTarget: string;
  exists: boolean;
  isSymlink: boolean;
  target?: string;
  targetResolved?: string;
  expected: boolean;
  broken: boolean;
}

interface SidecarContext {
  projectPath: string;
  devcenterRoot: string;
  projectName: string;
  storagePath: string;
  agentsTarget: string;
  devcenterTarget: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function yaml(value: unknown): string {
  return YAML.stringify(value, { lineWidth: 100, minContentWidth: 0 });
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function lstatOptional(filePath: string): Promise<import("node:fs").Stats | undefined> {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }

    throw error;
  }
}

export async function runGit(cwd: string, args: string[]): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? execError.message,
      code: typeof execError.code === "number" ? execError.code : 1
    };
  }
}

async function gitOutput(cwd: string, args: string[]): Promise<string | undefined> {
  const result = await runGit(cwd, args);
  return result.code === 0 ? result.stdout.trim() : undefined;
}

async function gitTopLevel(projectPath: string): Promise<string | undefined> {
  const output = await gitOutput(projectPath, ["rev-parse", "--show-toplevel"]);
  return output ? path.resolve(projectPath, output) : undefined;
}

// For a linked git worktree, returns the main checkout's top-level directory;
// undefined for the main worktree, bare repos, and non-git paths. Lets every
// worktree of a repo share one sidecar project instead of minting a new one
// named after the worktree directory.
async function gitMainTopLevel(projectPath: string): Promise<string | undefined> {
  const gitDir = await gitOutput(projectPath, ["rev-parse", "--absolute-git-dir"]);
  const commonDir = await gitOutput(projectPath, ["rev-parse", "--git-common-dir"]);
  if (!gitDir || !commonDir) {
    return undefined;
  }

  const resolvedCommon = path.resolve(projectPath, commonDir);
  if (path.resolve(gitDir) === resolvedCommon || path.basename(resolvedCommon) !== ".git") {
    return undefined;
  }

  return path.dirname(resolvedCommon);
}

async function gitPath(projectPath: string, gitPathName: string): Promise<string | undefined> {
  const output = await gitOutput(projectPath, ["rev-parse", "--git-path", gitPathName]);
  return output ? path.resolve(projectPath, output) : undefined;
}

async function readProjectYamlName(projectPath: string): Promise<string | undefined> {
  const raw = await readTextIfExists(path.join(projectPath, ".devcenter", "project.yaml"));
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = YAML.parse(raw);
    return typeof parsed?.name === "string" && parsed.name.trim() ? parsed.name.trim() : undefined;
  } catch {
    return undefined;
  }
}

function safeProjectName(name: string): string {
  return name.trim().replace(/[/:\\]/g, "-");
}

async function detectProjectName(projectPath: string): Promise<string> {
  const projectYamlName = await readProjectYamlName(projectPath);
  if (projectYamlName) {
    return safeProjectName(projectYamlName);
  }

  const mainTopLevel = await gitMainTopLevel(projectPath);
  if (mainTopLevel) {
    const mainName = await readProjectYamlName(mainTopLevel);
    return safeProjectName(mainName ?? path.basename(mainTopLevel));
  }

  const repoTopLevel = await gitTopLevel(projectPath);
  return safeProjectName(path.basename(repoTopLevel ?? projectPath));
}

// The home (memory repo) is resolved from DEVCENTER_HOME, then
// ~/.devcenter/config.json, then falls back to the repo the code lives in.
export async function defaultDevCenterRoot(): Promise<string> {
  return (await resolveDevCenterHome()).home;
}

export async function createSidecarContext(
  projectPathInput = ".",
  devcenterRootInput?: string
): Promise<SidecarContext> {
  const resolvedInput = path.resolve(projectPathInput);
  // Sidecar links belong at the checkout root (of the main repo or of a linked
  // worktree), even when the command runs from a subdirectory.
  const projectPath = (await gitTopLevel(resolvedInput)) ?? resolvedInput;
  const devcenterRoot = path.resolve(devcenterRootInput ?? (await defaultDevCenterRoot()));
  const projectName = await detectProjectName(projectPath);
  const storagePath = path.join(devcenterRoot, "projects", projectName);

  return {
    projectPath,
    devcenterRoot,
    projectName,
    storagePath,
    agentsTarget: path.join(storagePath, "AGENTS.md"),
    devcenterTarget: path.join(storagePath, ".devcenter")
  };
}

function defaultAgents(projectName: string): string {
  return `# ${projectName} — Agent Instructions

This file and \`.devcenter/\` are private DevCenter project memory. They live in the DevCenter home repo and appear here through local symlinks that the project repo never tracks. Treat them as the communication channel between you and the project owner.

## Standards and context

\`devcenter ensure\` prints \`.devcenter/standards.yaml\` and \`.devcenter/context.md\` at session start when it runs from a SessionStart hook. Read \`.devcenter/global-standards.yaml\` before branching, committing, pushing, opening a PR/MR, or setting up a repo or CI. It is a generated snapshot of the merged global standards (devcenter defaults + environment overlay); edit the sources in the DevCenter repos, never this file.

## Before you start

1. If the session did not start with the project standards and context, read \`.devcenter/standards.yaml\` and \`.devcenter/context.md\`.
2. Read \`.devcenter/project.yaml\` and \`.devcenter/tasks.yaml\`.
3. If a task in \`tasks.yaml\` covers your work, take it: set its status to \`in_progress\`.
4. Working in parallel with other threads? Use a git worktree, then run \`devcenter attach\` inside it — the links restore automatically and point at this same shared memory.

## While you work

- Keep public project docs (README, setup, architecture) product-facing; they must not mention DevCenter.
- Local paths, workflow notes, branch intent, and handoff context belong in these private files instead.

## Before you finish

1. Update \`.devcenter/tasks.yaml\`: mark finished work \`done\`, and add a task for any follow-up you discovered (\`devcenter task add "<title>"\` works from this directory).
2. Append a dated summary of what you did to \`.devcenter/agent-log.md\` (\`devcenter log "<summary>"\`).
3. Update \`.devcenter/context.md\` if the project's state, problems, or next steps changed.
4. Record durable choices in \`.devcenter/decisions.md\`.
5. If the \`devcenter\` CLI is available, run \`devcenter sync\` to publish the memory update.
`;
}

function defaultFile(projectName: string, relativePath: string): string {
  switch (relativePath) {
    case "project.yaml":
      return yaml({
        name: projectName,
        summary: "Private DevCenter project memory.",
        status: "active",
        stack: [],
        current_focus: "Keep sidecar project memory current.",
        owner: "",
        created: today(),
        tags: []
      });
    case "context.md":
      return `# ${projectName} Context

## Current Goals

- Keep project memory private in the DevCenter sidecar repo.
- Keep public project docs product-facing.

## Current Work

- Sidecar memory has been attached.

## Known Problems

- Replace bootstrap placeholders with project-specific context.

## Next Steps

- Review \`.devcenter/tasks.yaml\`.
- Record important decisions in \`.devcenter/decisions.md\`.

## Important Files

- \`README.md\`
- \`AGENTS.md\`
- \`.devcenter/project.yaml\`
- \`.devcenter/tasks.yaml\`
`;
    case "tasks.yaml":
      return yaml([]);
    case "decisions.md":
      return `# Decisions

## ${today()}: Store project memory in DevCenter sidecar

Private agent and project memory lives under \`projects/${projectName}/\` in the DevCenter repo and is symlinked into the project checkout.
`;
    case "agent-log.md":
      return `# Agent Log

## ${today()}

- Attached DevCenter sidecar project memory.
`;
    case "standards.yaml":
      return yaml({
        version: 1,
        metadata: {
          name: `${projectName} Standards`,
          status: "active",
          description: "Project-specific standards that override global DevCenter standards when needed."
        },
        standards_management: {
          inherits: ".devcenter/global-standards.yaml",
          project_overrides_global: true
        }
      });
    default:
      throw new Error(`No default template for ${relativePath}`);
  }
}

function defaultGlobalStandards(): string {
  return `version: 2
metadata:
  name: Global Standards Overlay
  description: Environment-specific conventions layered on top of the devcenter
    built-in defaults (standards/defaults.yaml in the app repo). Objects deep-merge;
    arrays and scalars listed here replace the default values. Project
    .devcenter/standards.yaml files override both.

# Add environment-specific overrides below (e.g. stricter PR policy on a work
# machine). Everything not listed here inherits the devcenter defaults.
`;
}

async function ensureGlobalStandards(devcenterRoot: string, messages: string[]): Promise<void> {
  const globalPath = path.join(devcenterRoot, globalStandardsRelative);
  if (!(await pathExists(globalPath))) {
    await fs.mkdir(path.dirname(globalPath), { recursive: true });
    await fs.writeFile(globalPath, defaultGlobalStandards(), "utf8");
    messages.push(`created ${globalStandardsRelative}`);
  }
}

async function ensureMaterializedStandards(context: SidecarContext, messages: string[]): Promise<void> {
  // The defaults layer lives in the app repo and the overlay in the home repo,
  // so a cross-repo symlink cannot express the merge; a generated snapshot can,
  // and it stays valid even when the app repo moves between machines.
  const outcome = await materializeGlobalStandards(context.devcenterRoot, context.devcenterTarget);
  const relative = path.relative(context.devcenterRoot, outcome.filePath);
  switch (outcome.action) {
    case "created":
      messages.push(`created ${relative} (merged standards snapshot)`);
      break;
    case "refreshed":
      messages.push(`refreshed ${relative}`);
      break;
    case "replaced-symlink":
      messages.push(`replaced ${relative} symlink with a merged standards snapshot`);
      break;
    case "unchanged":
      break;
  }
}

async function ensureDefaultSidecarFiles(context: SidecarContext, messages: string[], warnings: string[]): Promise<void> {
  await fs.mkdir(context.devcenterTarget, { recursive: true });
  await ensureGlobalStandards(context.devcenterRoot, messages);
  await ensureMaterializedStandards(context, messages);

  if (!(await pathExists(context.agentsTarget))) {
    await fs.writeFile(context.agentsTarget, defaultAgents(context.projectName), "utf8");
    messages.push(`created ${path.relative(context.devcenterRoot, context.agentsTarget)}`);
  }

  for (const fileName of sidecarFiles) {
    const target = path.join(context.devcenterTarget, fileName);
    if (!(await pathExists(target))) {
      await fs.writeFile(target, defaultFile(context.projectName, fileName), "utf8");
      messages.push(`created ${path.relative(context.devcenterRoot, target)}`);
    }
  }
}

async function copyMissing(source: string, target: string): Promise<void> {
  const stats = await lstatOptional(source);
  if (!stats) {
    return;
  }

  if (await pathExists(target)) {
    if (stats.isDirectory()) {
      await fs.mkdir(target, { recursive: true });
      const entries = await fs.readdir(source, { withFileTypes: true });
      for (const entry of entries) {
        await copyMissing(path.join(source, entry.name), path.join(target, entry.name));
      }
    }
    return;
  }

  await fs.cp(source, target, {
    recursive: stats.isDirectory(),
    dereference: false,
    errorOnExist: false,
    force: false
  });
}

async function isExpectedSymlink(localPath: string, expectedTarget: string): Promise<boolean> {
  const stats = await lstatOptional(localPath);
  if (!stats?.isSymbolicLink()) {
    return false;
  }

  const target = await fs.readlink(localPath);
  return path.resolve(path.dirname(localPath), target) === path.resolve(expectedTarget);
}

async function trackedMemoryPaths(projectPath: string): Promise<string[]> {
  const topLevel = await gitTopLevel(projectPath);
  if (!topLevel) {
    return [];
  }

  const result = await runGit(topLevel, ["ls-files", "--", "AGENTS.md", ".devcenter"]);
  if (result.code !== 0) {
    return [];
  }

  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function trackedCommand(paths: string[]): string {
  return `git rm -r --cached ${paths.join(" ")}`;
}

async function ensureExcludeEntries(projectPath: string, messages: string[]): Promise<Record<(typeof localMemoryPaths)[number], boolean>> {
  const excludePath = await gitPath(projectPath, "info/exclude");
  const status: Record<(typeof localMemoryPaths)[number], boolean> = {
    "AGENTS.md": false,
    ".devcenter": false
  };

  if (!excludePath) {
    return status;
  }

  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  const existing = (await readTextIfExists(excludePath)) ?? "";
  const lines = existing.split(/\r?\n/);
  const needed = ["AGENTS.md", "CLAUDE.md", ".devcenter/", ".devcenter"];
  const additions = needed.filter((entry) => !lines.includes(entry));

  if (additions.length > 0) {
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await fs.appendFile(excludePath, `${prefix}${additions.join("\n")}\n`, "utf8");
    messages.push(`updated ${path.relative(projectPath, excludePath)} with ${additions.join(", ")}`);
  }

  const updated = (await readTextIfExists(excludePath)) ?? "";
  const updatedLines = updated.split(/\r?\n/);
  status["AGENTS.md"] = updatedLines.includes("AGENTS.md");
  status[".devcenter"] = updatedLines.includes(".devcenter/") || updatedLines.includes(".devcenter");
  return status;
}

async function readExcludeEntries(projectPath: string): Promise<Record<(typeof localMemoryPaths)[number], boolean>> {
  const excludePath = await gitPath(projectPath, "info/exclude");
  const status: Record<(typeof localMemoryPaths)[number], boolean> = {
    "AGENTS.md": false,
    ".devcenter": false
  };

  if (!excludePath) {
    return status;
  }

  const raw = (await readTextIfExists(excludePath)) ?? "";
  const lines = raw.split(/\r?\n/);
  status["AGENTS.md"] = lines.includes("AGENTS.md");
  status[".devcenter"] = lines.includes(".devcenter/") || lines.includes(".devcenter");
  return status;
}

async function readIgnoredPaths(projectPath: string): Promise<Record<(typeof localMemoryPaths)[number], boolean>> {
  const status: Record<(typeof localMemoryPaths)[number], boolean> = {
    "AGENTS.md": false,
    ".devcenter": false
  };

  const topLevel = await gitTopLevel(projectPath);
  if (!topLevel) {
    return status;
  }

  for (const localName of localMemoryPaths) {
    const result = await runGit(topLevel, ["check-ignore", "-q", "--", localName]);
    status[localName] = result.code === 0;
  }

  return status;
}

async function backupLocalMemory(context: SidecarContext, localPath: string, label: string, messages: string[]): Promise<void> {
  const backupRoot = path.join(context.storagePath, ".backups", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(backupRoot, { recursive: true });
  await fs.cp(localPath, path.join(backupRoot, label), { recursive: true, dereference: false });
  messages.push(`backed up ${label} to ${path.relative(context.devcenterRoot, backupRoot)}`);
}

async function absorbExistingMemory(context: SidecarContext, backup: boolean, messages: string[], warnings: string[]): Promise<void> {
  const tracked = await trackedMemoryPaths(context.projectPath);

  for (const localName of localMemoryPaths) {
    const localPath = path.join(context.projectPath, localName);
    const targetPath = localName === "AGENTS.md" ? context.agentsTarget : context.devcenterTarget;
    const stats = await lstatOptional(localPath);

    if (!stats || (await isExpectedSymlink(localPath, targetPath))) {
      continue;
    }

    if (stats.isSymbolicLink()) {
      const currentTarget = path.resolve(path.dirname(localPath), await fs.readlink(localPath));
      if (!(await pathExists(currentTarget))) {
        // Dead link from a moved or renamed home; there is nothing to absorb
        // and the link-repair step will repoint it.
        continue;
      }
      warnings.push(`${localName} is a symlink to an unexpected target; leaving it unchanged.`);
      continue;
    }

    const trackedHits = tracked.filter((entry) => entry === localName || entry.startsWith(`${localName}/`));
    if (trackedHits.length > 0) {
      await copyMissing(localPath, targetPath);
      warnings.push(`${localName} is tracked by the project repo; copied contents to sidecar but left local files unchanged.`);
      warnings.push(`To stop tracking project memory, run: ${trackedCommand([...new Set(trackedHits.map((entry) => entry.split("/")[0]))])}`);
      continue;
    }

    await copyMissing(localPath, targetPath);
    if (backup) {
      await backupLocalMemory(context, localPath, localName, messages);
    }
    await fs.rm(localPath, { recursive: true, force: true });
    messages.push(`moved ${localName} into ${path.relative(context.devcenterRoot, targetPath)}`);
  }
}

async function ensureSymlink(localPath: string, targetPath: string, type: "file" | "dir", messages: string[], warnings: string[]): Promise<void> {
  const stats = await lstatOptional(localPath);
  if (!stats) {
    await fs.symlink(targetPath, localPath, type);
    messages.push(`linked ${localPath} -> ${targetPath}`);
    return;
  }

  if (stats.isSymbolicLink()) {
    if (await isExpectedSymlink(localPath, targetPath)) {
      return;
    }

    // A dead link (e.g. the home repo moved or was renamed) is safe to
    // repoint; a live link to somewhere unexpected is not ours to change.
    const currentTarget = path.resolve(path.dirname(localPath), await fs.readlink(localPath));
    if (!(await pathExists(currentTarget))) {
      await fs.unlink(localPath);
      await fs.symlink(targetPath, localPath, type);
      messages.push(`repaired broken link ${localPath} -> ${targetPath}`);
      return;
    }

    warnings.push(`${localPath} points somewhere unexpected; leaving it unchanged.`);
    return;
  }

  warnings.push(`${localPath} is not a symlink; leaving it unchanged.`);
}

async function repairSymlinkAfterBackup(
  context: SidecarContext,
  localName: (typeof localMemoryPaths)[number],
  targetPath: string,
  type: "file" | "dir",
  messages: string[],
  warnings: string[]
): Promise<void> {
  const localPath = path.join(context.projectPath, localName);
  const stats = await lstatOptional(localPath);
  if (!stats) {
    await fs.symlink(targetPath, localPath, type);
    messages.push(`linked ${localName} -> ${targetPath}`);
    return;
  }

  if (stats.isSymbolicLink()) {
    if (await isExpectedSymlink(localPath, targetPath)) {
      return;
    }

    const currentTarget = path.resolve(path.dirname(localPath), await fs.readlink(localPath));
    if (!(await pathExists(currentTarget))) {
      await fs.unlink(localPath);
      await fs.symlink(targetPath, localPath, type);
      messages.push(`repaired broken ${localName} link -> ${targetPath}`);
      return;
    }

    warnings.push(`${localName} points somewhere unexpected; leaving it unchanged.`);
    return;
  }

  const tracked = await trackedMemoryPaths(context.projectPath);
  const trackedHits = tracked.filter((entry) => entry === localName || entry.startsWith(`${localName}/`));
  if (trackedHits.length > 0) {
    warnings.push(`${localName} is tracked by the project repo; not replacing it.`);
    warnings.push(`To stop tracking project memory, run: ${trackedCommand([...new Set(trackedHits.map((entry) => entry.split("/")[0]))])}`);
    return;
  }

  await copyMissing(localPath, targetPath);
  await backupLocalMemory(context, localPath, localName, messages);
  await fs.rm(localPath, { recursive: true, force: true });
  await fs.symlink(targetPath, localPath, type);
  messages.push(`repaired ${localName} symlink`);
}

export async function attachSidecar(projectPathInput = ".", devcenterRootInput?: string): Promise<SidecarResult> {
  const context = await createSidecarContext(projectPathInput, devcenterRootInput);
  const messages: string[] = [];
  const warnings: string[] = [];

  const mainTopLevel = await gitMainTopLevel(context.projectPath);
  if (mainTopLevel) {
    messages.push(`linked worktree of ${mainTopLevel} — sharing sidecar project "${context.projectName}"`);
  }

  await fs.mkdir(context.storagePath, { recursive: true });
  await absorbExistingMemory(context, false, messages, warnings);
  await ensureDefaultSidecarFiles(context, messages, warnings);
  await ensureSymlink(path.join(context.projectPath, "AGENTS.md"), context.agentsTarget, "file", messages, warnings);
  await ensureSymlink(path.join(context.projectPath, claudeLocalName), context.agentsTarget, "file", messages, warnings);
  await ensureSymlink(path.join(context.projectPath, ".devcenter"), context.devcenterTarget, "dir", messages, warnings);
  await ensureExcludeEntries(context.projectPath, messages);

  return {
    projectName: context.projectName,
    projectPath: context.projectPath,
    storagePath: context.storagePath,
    messages: messages.length ? messages : [`${context.projectName} sidecar memory already attached.`],
    warnings,
    exitCode: 0
  };
}

async function inspectLink(localPath: string, expectedTarget: string): Promise<LinkStatus> {
  const stats = await lstatOptional(localPath);
  if (!stats) {
    return {
      localPath,
      expectedTarget,
      exists: false,
      isSymlink: false,
      expected: false,
      broken: true
    };
  }

  if (!stats.isSymbolicLink()) {
    return {
      localPath,
      expectedTarget,
      exists: true,
      isSymlink: false,
      expected: false,
      broken: false
    };
  }

  const target = await fs.readlink(localPath);
  const targetResolved = path.resolve(path.dirname(localPath), target);
  return {
    localPath,
    expectedTarget,
    exists: true,
    isSymlink: true,
    target,
    targetResolved,
    expected: targetResolved === path.resolve(expectedTarget),
    broken: !(await pathExists(targetResolved))
  };
}

async function sidecarChanges(context: SidecarContext): Promise<string[]> {
  const relativeStorage = path.relative(context.devcenterRoot, context.storagePath);
  const result = await runGit(context.devcenterRoot, ["status", "--short", "--untracked-files=all", "--", relativeStorage]);
  if (result.code !== 0) {
    return [];
  }

  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function statusSidecar(projectPathInput = ".", devcenterRootInput?: string): Promise<SidecarStatus> {
  const context = await createSidecarContext(projectPathInput, devcenterRootInput);
  const messages: string[] = [];
  const warnings: string[] = [];
  const agents = await inspectLink(path.join(context.projectPath, "AGENTS.md"), context.agentsTarget);
  const claude = await inspectLink(path.join(context.projectPath, claudeLocalName), context.agentsTarget);
  const devcenter = await inspectLink(path.join(context.projectPath, ".devcenter"), context.devcenterTarget);
  const projectTracked = await trackedMemoryPaths(context.projectPath);
  const excludeEntries = await readExcludeEntries(context.projectPath);
  const ignoredPaths = await readIgnoredPaths(context.projectPath);
  const changes = await sidecarChanges(context);

  messages.push(`project: ${context.projectName}`);
  messages.push(`storage: ${context.storagePath}`);
  messages.push(`AGENTS.md: ${describeLink(agents)}`);
  messages.push(`CLAUDE.md: ${describeLink(claude)}`);
  messages.push(`.devcenter: ${describeLink(devcenter)}`);
  messages.push(`ignored: AGENTS.md=${ignoredPaths["AGENTS.md"] ? "yes" : "no"}, .devcenter=${ignoredPaths[".devcenter"] ? "yes" : "no"}`);
  messages.push(`sidecar changes: ${changes.length ? `${changes.length} file(s)` : "none"}`);

  if (projectTracked.length > 0) {
    warnings.push(`Project repo tracks sidecar paths: ${[...new Set(projectTracked.map((entry) => entry.split("/")[0]))].join(", ")}`);
    warnings.push(`To stop tracking project memory, run: ${trackedCommand([...new Set(projectTracked.map((entry) => entry.split("/")[0]))])}`);
  }

  for (const link of [agents, devcenter]) {
    if (link.exists && link.isSymlink && !link.expected) {
      warnings.push(`${path.basename(link.localPath)} points to ${link.targetResolved}; expected ${link.expectedTarget}.`);
    }
  }

  const exitCode = agents.broken || devcenter.broken ? 1 : 0;
  return {
    projectName: context.projectName,
    projectPath: context.projectPath,
    storagePath: context.storagePath,
    messages,
    warnings,
    exitCode,
    agents,
    claude,
    devcenter,
    projectTracked,
    excludeEntries,
    ignoredPaths,
    sidecarDirty: changes.length > 0,
    sidecarChanges: changes
  };
}

function describeLink(link: LinkStatus): string {
  if (!link.exists) {
    return "missing";
  }

  if (!link.isSymlink) {
    return "present, not symlinked";
  }

  if (link.broken) {
    return `broken symlink -> ${link.target}`;
  }

  return link.expected ? `symlinked -> ${link.expectedTarget}` : `symlinked -> ${link.targetResolved}`;
}

export async function doctorSidecar(projectPathInput = ".", devcenterRootInput?: string): Promise<SidecarResult> {
  const context = await createSidecarContext(projectPathInput, devcenterRootInput);
  const messages: string[] = [];
  const warnings: string[] = [];

  await fs.mkdir(context.storagePath, { recursive: true });
  await absorbExistingMemory(context, true, messages, warnings);
  await ensureDefaultSidecarFiles(context, messages, warnings);
  await repairSymlinkAfterBackup(context, "AGENTS.md", context.agentsTarget, "file", messages, warnings);
  await ensureSymlink(path.join(context.projectPath, claudeLocalName), context.agentsTarget, "file", messages, warnings);
  await repairSymlinkAfterBackup(context, ".devcenter", context.devcenterTarget, "dir", messages, warnings);
  await ensureExcludeEntries(context.projectPath, messages);

  return {
    projectName: context.projectName,
    projectPath: context.projectPath,
    storagePath: context.storagePath,
    messages: messages.length ? messages : [`No repairs needed for ${context.projectName}.`],
    warnings,
    exitCode: 0
  };
}

async function removeExcludeEntries(projectPath: string, messages: string[]): Promise<void> {
  const excludePath = await gitPath(projectPath, "info/exclude");
  if (!excludePath) {
    return;
  }

  const existing = await readTextIfExists(excludePath);
  if (existing === undefined) {
    return;
  }

  const lines = existing.split(/\r?\n/);
  const managed = new Set(["AGENTS.md", "CLAUDE.md", ".devcenter/", ".devcenter"]);
  const filtered = lines.filter((line) => !managed.has(line));
  if (filtered.length !== lines.length) {
    await fs.writeFile(excludePath, filtered.join("\n"), "utf8");
    messages.push(`removed AGENTS.md, CLAUDE.md, and .devcenter/ from ${path.relative(projectPath, excludePath)}`);
  }
}

export async function detachSidecar(projectPathInput = ".", options: { devcenterRoot?: string; cleanExclude?: boolean } = {}): Promise<SidecarResult> {
  const context = await createSidecarContext(projectPathInput, options.devcenterRoot);
  const messages: string[] = [];
  const warnings: string[] = [];

  for (const localName of [...localMemoryPaths, claudeLocalName]) {
    const localPath = path.join(context.projectPath, localName);
    const stats = await lstatOptional(localPath);
    if (!stats) {
      continue;
    }

    if (!stats.isSymbolicLink()) {
      warnings.push(`${localName} is not a symlink; leaving it unchanged.`);
      continue;
    }

    await fs.unlink(localPath);
    messages.push(`removed ${localName} symlink`);
  }

  if (options.cleanExclude) {
    await removeExcludeEntries(context.projectPath, messages);
  }

  return {
    projectName: context.projectName,
    projectPath: context.projectPath,
    storagePath: context.storagePath,
    messages: messages.length ? messages : [`No sidecar symlinks found for ${context.projectName}.`],
    warnings,
    exitCode: 0
  };
}

export async function commitSidecar(projectPathInput = ".", message?: string, devcenterRootInput?: string): Promise<SidecarResult> {
  const context = await createSidecarContext(projectPathInput, devcenterRootInput);
  const messages: string[] = [];
  const warnings: string[] = [];
  const relativeStorage = path.relative(context.devcenterRoot, context.storagePath);
  const changes = await sidecarChanges(context);

  if (changes.length === 0) {
    messages.push(`No changes to commit for ${context.projectName}.`);
    return {
      projectName: context.projectName,
      projectPath: context.projectPath,
      storagePath: context.storagePath,
      messages,
      warnings,
      exitCode: 0
    };
  }

  const add = await runGit(context.devcenterRoot, ["add", "--", relativeStorage]);
  if (add.code !== 0) {
    throw new Error(add.stderr || "git add failed");
  }

  const commitMessage = message ?? `update ${context.projectName} memory`;
  const commit = await runGit(context.devcenterRoot, ["commit", "-m", commitMessage, "--", relativeStorage]);
  if (commit.code !== 0) {
    throw new Error(commit.stderr || "git commit failed");
  }

  messages.push(commit.stdout.trim() || `Committed ${relativeStorage}.`);
  return {
    projectName: context.projectName,
    projectPath: context.projectPath,
    storagePath: context.storagePath,
    messages,
    warnings,
    exitCode: 0
  };
}

async function countOpenTasks(devcenterTarget: string): Promise<number | undefined> {
  const raw = await readTextIfExists(path.join(devcenterTarget, "tasks.yaml"));
  if (raw === undefined) {
    return undefined;
  }

  try {
    const parsed = YAML.parse(raw);
    if (!Array.isArray(parsed)) {
      return 0;
    }

    return parsed.filter((task) => {
      if (!task || typeof task !== "object" || Array.isArray(task)) {
        return false;
      }
      return (task as Record<string, unknown>).status !== "done";
    }).length;
  } catch {
    return undefined;
  }
}

// Hook-friendly entry point (e.g. Claude Code SessionStart): silent outside git
// repos, repairs links for known projects, and only hints — never auto-creates
// memory — for repos that were never attached.
export async function ensureSidecar(projectPathInput = ".", devcenterRootInput?: string): Promise<SidecarResult> {
  const resolvedInput = path.resolve(projectPathInput);
  const quiet = (projectName: string, projectPath: string, storagePath: string): SidecarResult => ({
    projectName,
    projectPath,
    storagePath,
    messages: [],
    warnings: [],
    exitCode: 0
  });

  const topLevel = await gitTopLevel(resolvedInput);
  if (!topLevel) {
    return quiet("", resolvedInput, "");
  }

  const context = await createSidecarContext(projectPathInput, devcenterRootInput);
  // Compare realpaths: git resolves symlinked paths (e.g. /tmp on macOS) while
  // the configured home may be spelled through the symlink.
  const [projectReal, homeReal] = await Promise.all([
    fs.realpath(context.projectPath).catch(() => context.projectPath),
    fs.realpath(context.devcenterRoot).catch(() => context.devcenterRoot)
  ]);
  if (projectReal === homeReal) {
    return quiet(context.projectName, context.projectPath, context.storagePath);
  }

  const known = await pathExists(context.devcenterTarget);
  if (!known) {
    return {
      projectName: context.projectName,
      projectPath: context.projectPath,
      storagePath: context.storagePath,
      messages: [
        `DevCenter: "${context.projectName}" is not a managed project. Run \`devcenter attach\` to create private sidecar memory for it, or ignore this if the repo should stay unmanaged.`
      ],
      warnings: [],
      exitCode: 0
    };
  }

  const attach = await attachSidecar(projectPathInput, devcenterRootInput);
  const didWork = attach.messages.some((message) => /^(linked|created|moved|repaired|replaced|refreshed)/.test(message));
  const openTasks = await countOpenTasks(context.devcenterTarget);
  const taskSummary = openTasks === undefined ? "" : ` — ${openTasks} open task${openTasks === 1 ? "" : "s"}`;
  const messages = [
    ...(didWork ? [`DevCenter: restored sidecar links for "${context.projectName}".`] : []),
    `DevCenter: "${context.projectName}" attached${taskSummary}.`,
    ...(await sessionBriefing(context.devcenterTarget))
  ];

  return { ...attach, messages };
}

// Session-start hooks cap injected output (Claude Code: 10,000 characters), so
// each printed file gets a budget and the rest stays one read away.
export const briefingLimits = { "standards.yaml": 2000, "context.md": 6000 } as const;

function capText(text: string, limit: number, relativePath: string): string {
  const trimmed = text.trimEnd();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  const cut = trimmed.lastIndexOf("\n", limit);
  const kept = trimmed.slice(0, cut > 0 ? cut : limit).trimEnd();
  return `${kept}\n[truncated at ${kept.length} of ${trimmed.length} characters; read ${relativePath} for the rest]`;
}

async function sessionBriefing(devcenterTarget: string): Promise<string[]> {
  const sections: string[] = [];
  const files: Array<[keyof typeof briefingLimits, string]> = [
    ["standards.yaml", "Project standards"],
    ["context.md", "Project context"]
  ];
  for (const [fileName, label] of files) {
    const raw = await readTextIfExists(path.join(devcenterTarget, fileName));
    if (!raw?.trim()) {
      continue;
    }
    const relativePath = `.devcenter/${fileName}`;
    sections.push(`\n${label} (${relativePath}):\n${capText(raw, briefingLimits[fileName], relativePath)}`);
  }
  sections.push(
    "\nRead .devcenter/global-standards.yaml before branching, committing, pushing, opening a PR/MR, or setting up a repo or CI. Tasks live in .devcenter/tasks.yaml."
  );
  return sections;
}

export async function pushDevCenter(devcenterRootInput?: string): Promise<SidecarResult> {
  const devcenterRoot = path.resolve(devcenterRootInput ?? (await defaultDevCenterRoot()));
  const result = await runGit(devcenterRoot, ["push"]);
  if (result.code !== 0) {
    throw new Error(result.stderr || "git push failed");
  }

  return {
    projectName: "",
    projectPath: devcenterRoot,
    storagePath: path.join(devcenterRoot, "projects"),
    messages: [result.stdout.trim() || result.stderr.trim() || "Pushed DevCenter current branch."],
    warnings: [],
    exitCode: 0
  };
}
