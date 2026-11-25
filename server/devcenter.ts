import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { nextTaskId } from "./taskIds";
import type {
  BranchIntent,
  ComplianceIssue,
  DevCenterStandards,
  GitState,
  ProjectDocument,
  ProjectMetadata,
  ProjectSummary,
  ProjectTask,
  TaskCounts,
  TaskStatus
} from "../src/types";
import { collectGitState } from "./git";

const taskStatuses: TaskStatus[] = ["inbox", "backlog", "next", "in_progress", "blocked", "done"];

const knownDocuments = [
  { key: "readme", label: "README", candidates: ["README.md", "README"] },
  { key: "agents", label: "AGENTS", candidates: ["AGENTS.md"] },
  { key: "claude", label: "CLAUDE", candidates: ["CLAUDE.md"] },
  { key: "project", label: "PROJECT", candidates: ["PROJECT.md"] },
  { key: "branches", label: "Branches", candidates: [".devcenter/branches.yaml"] },
  { key: "context", label: "Context", candidates: [".devcenter/context.md"] },
  { key: "decisions", label: "Decisions", candidates: [".devcenter/decisions.md"] },
  { key: "agent-log", label: "Agent Log", candidates: [".devcenter/agent-log.md"] }
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }

  if (typeof value === "string" && value.length > 0) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function normalizeMetadata(value: unknown): ProjectMetadata {
  if (!isObject(value)) {
    return { stack: [], tags: [] };
  }

  return {
    name: typeof value.name === "string" ? value.name : undefined,
    summary: typeof value.summary === "string" ? value.summary : undefined,
    status: typeof value.status === "string" ? value.status : undefined,
    stack: toStringArray(value.stack),
    current_focus: typeof value.current_focus === "string" ? value.current_focus : undefined,
    owner: typeof value.owner === "string" ? value.owner : undefined,
    created: typeof value.created === "string" ? value.created : undefined,
    tags: toStringArray(value.tags)
  };
}

function normalizeTask(value: unknown, index: number): ProjectTask | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const title = typeof value.title === "string" ? value.title : undefined;
  if (!title) {
    return undefined;
  }

  const rawStatus = typeof value.status === "string" ? value.status : "backlog";
  const status = taskStatuses.includes(rawStatus as TaskStatus) ? (rawStatus as TaskStatus) : "backlog";

  return {
    id: typeof value.id === "string" && value.id.length > 0 ? value.id : `task-${index + 1}`,
    title,
    status,
    priority: typeof value.priority === "string" ? value.priority : undefined,
    branch: typeof value.branch === "string" ? value.branch : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined
  };
}

function normalizeBranchIntent(name: string, value: unknown): BranchIntent {
  const entry = isObject(value) ? value : {};

  return {
    name,
    role: typeof entry.role === "string" ? entry.role : undefined,
    status: typeof entry.status === "string" ? entry.status : undefined,
    parent: typeof entry.parent === "string" ? entry.parent : undefined,
    purpose: typeof entry.purpose === "string" ? entry.purpose : undefined,
    worktree: typeof entry.worktree === "string" ? entry.worktree : undefined,
    notes: toStringArray(entry.notes)
  };
}

export function normalizeBranchIntents(value: unknown): BranchIntent[] {
  if (Array.isArray(value)) {
    return value
      .filter(isObject)
      .filter((entry) => typeof entry.name === "string" && entry.name.length > 0)
      .map((entry) => normalizeBranchIntent(entry.name as string, entry));
  }

  if (!isObject(value) || !isObject(value.branches)) {
    return [];
  }

  return Object.entries(value.branches).map(([name, entry]) => normalizeBranchIntent(name, entry));
}

async function readYaml(filePath: string): Promise<{ exists: boolean; value?: unknown; parseError?: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false };
    }

    throw error;
  }

  // One hand-edited file with bad YAML must not take down the whole scan.
  try {
    return { exists: true, value: YAML.parse(raw) };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { exists: true, parseError: message };
  }
}

async function statOptional(filePath: string): Promise<import("node:fs").Stats | undefined> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function firstExistingDocument(repoPath: string, entry: (typeof knownDocuments)[number]): Promise<ProjectDocument> {
  for (const candidate of entry.candidates) {
    const fullPath = path.join(repoPath, candidate);
    const stats = await statOptional(fullPath);
    if (stats?.isFile()) {
      return {
        key: entry.key,
        label: entry.label,
        relativePath: candidate,
        exists: true,
        empty: stats.size === 0,
        bytes: stats.size,
        updatedAt: stats.mtime.toISOString()
      };
    }
  }

  return {
    key: entry.key,
    label: entry.label,
    relativePath: entry.candidates[0],
    exists: false,
    empty: true,
    bytes: 0
  };
}

async function architectureDocuments(repoPath: string): Promise<ProjectDocument[]> {
  const docsDir = path.join(repoPath, "docs");
  let entries;
  try {
    entries = await fs.readdir(docsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const matches = entries
    .filter((entry) => entry.isFile() && /\.(md|mdx|txt)$/i.test(entry.name))
    .filter((entry) => /(arch|adr|decision|design)/i.test(entry.name))
    .slice(0, 8);

  return Promise.all(
    matches.map(async (entry) => {
      const relativePath = path.join("docs", entry.name);
      const stats = await fs.stat(path.join(repoPath, relativePath));
      return {
        key: `docs/${entry.name}`,
        label: entry.name,
        relativePath,
        exists: true,
        empty: stats.size === 0,
        bytes: stats.size,
        updatedAt: stats.mtime.toISOString()
      };
    })
  );
}

async function readMetadata(repoPath: string): Promise<{ exists: boolean; metadata: ProjectMetadata; parseError?: string }> {
  const result = await readYaml(path.join(repoPath, ".devcenter", "project.yaml"));
  return {
    exists: result.exists,
    parseError: result.parseError,
    metadata: normalizeMetadata(result.value)
  };
}

async function readBranchIntents(repoPath: string): Promise<{ exists: boolean; intents: BranchIntent[]; parseError?: string }> {
  const result = await readYaml(path.join(repoPath, ".devcenter", "branches.yaml"));
  return {
    exists: result.exists,
    parseError: result.parseError,
    intents: normalizeBranchIntents(result.value)
  };
}

async function readTasks(repoPath: string): Promise<{ exists: boolean; tasks: ProjectTask[]; parseError?: string }> {
  const result = await readYaml(path.join(repoPath, ".devcenter", "tasks.yaml"));
  const values = Array.isArray(result.value) ? result.value : [];
  return {
    exists: result.exists,
    parseError: result.parseError,
    tasks: values.map(normalizeTask).filter((task): task is ProjectTask => Boolean(task))
  };
}

export interface ProjectTaskChanges {
  title?: string;
  status?: string;
  priority?: string;
  branch?: string;
  notes?: string;
}

/**
 * Update one task in `<repoPath>/.devcenter/tasks.yaml` in place. Works on the
 * raw parsed YAML so fields this app does not model (created, source, …) are
 * preserved. Returns the normalized task list after the write.
 */
async function readRawTaskList(repoPath: string): Promise<{ tasksPath: string; parsed: unknown[] }> {
  const tasksPath = path.join(repoPath, ".devcenter", "tasks.yaml");

  let raw: string;
  try {
    raw = await fs.readFile(tasksPath, "utf8");
  } catch {
    throw new Error("This project has no .devcenter/tasks.yaml. Attach it with `devcenter attach` first.");
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    throw new Error(`.devcenter/tasks.yaml is not valid YAML: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  if (parsed === null || parsed === undefined) {
    return { tasksPath, parsed: [] };
  }
  if (!Array.isArray(parsed)) {
    throw new Error(".devcenter/tasks.yaml is not a task list.");
  }

  return { tasksPath, parsed };
}

async function writeRawTaskList(tasksPath: string, parsed: unknown[]): Promise<ProjectTask[]> {
  await fs.writeFile(tasksPath, YAML.stringify(parsed, { lineWidth: 100, minContentWidth: 0 }), "utf8");
  return parsed.map(normalizeTask).filter((task): task is ProjectTask => Boolean(task));
}

export interface NewProjectTask {
  title: string;
  status?: string;
  priority?: string;
  notes?: string;
}

/** Append a task to `<repoPath>/.devcenter/tasks.yaml`. Returns the new id and the task list. */
export async function createProjectTask(repoPath: string, input: NewProjectTask): Promise<{ id: string; tasks: ProjectTask[] }> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Task title cannot be empty.");
  }

  const status = input.status || "inbox";
  if (!taskStatuses.includes(status as TaskStatus)) {
    throw new Error(`Unknown status "${status}". Valid statuses: ${taskStatuses.join(", ")}.`);
  }

  const { tasksPath, parsed } = await readRawTaskList(repoPath);
  const existingIds = parsed.map((entry) => (isObject(entry) && typeof entry.id === "string" ? entry.id : ""));
  const id = nextTaskId(path.basename(repoPath), existingIds);
  const record: Record<string, unknown> = { id, title, status, priority: input.priority || "medium", branch: "", notes: input.notes ?? "" };
  parsed.push(record);
  return { id, tasks: await writeRawTaskList(tasksPath, parsed) };
}

/** Remove one task. The home repo's git history is the undo. */
export async function deleteProjectTask(repoPath: string, taskId: string): Promise<ProjectTask[]> {
  const { tasksPath, parsed } = await readRawTaskList(repoPath);
  const index = parsed.findIndex((entry) => isObject(entry) && typeof entry.id === "string" && entry.id.toLowerCase() === taskId.toLowerCase());
  if (index === -1) {
    throw new Error(`No task with id "${taskId}" in this project.`);
  }

  parsed.splice(index, 1);
  return writeRawTaskList(tasksPath, parsed);
}

export async function updateProjectTask(
  repoPath: string,
  taskId: string,
  changes: ProjectTaskChanges
): Promise<ProjectTask[]> {
  const { tasksPath, parsed } = await readRawTaskList(repoPath);

  const entry = parsed.find((candidate, index) => {
    if (!isObject(candidate)) {
      return false;
    }
    const id = typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : `task-${index + 1}`;
    return id.toLowerCase() === taskId.toLowerCase();
  }) as Record<string, unknown> | undefined;

  if (!entry) {
    throw new Error(`No task with id "${taskId}" in this project.`);
  }

  if (changes.title !== undefined) {
    const title = changes.title.trim();
    if (!title) {
      throw new Error("Task title cannot be empty.");
    }
    entry.title = title;
  }

  if (changes.status !== undefined) {
    if (!taskStatuses.includes(changes.status as TaskStatus)) {
      throw new Error(`Unknown status "${changes.status}". Valid statuses: ${taskStatuses.join(", ")}.`);
    }
    entry.status = changes.status;
  }

  if (changes.priority !== undefined) {
    entry.priority = changes.priority;
  }

  if (changes.branch !== undefined) {
    entry.branch = changes.branch;
  }

  if (changes.notes !== undefined) {
    entry.notes = changes.notes;
  }

  return writeRawTaskList(tasksPath, parsed);
}

function countTasks(tasks: ProjectTask[]): TaskCounts {
  return tasks.reduce<TaskCounts>(
    (counts, task) => {
      counts[task.status] += 1;
      return counts;
    },
    { inbox: 0, backlog: 0, next: 0, in_progress: 0, blocked: 0, done: 0 }
  );
}

function templateToRegex(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace("\\{slug\\}", "[a-z0-9][a-z0-9._-]*")}$`);
}

function branchNameIsAllowed(branch: string, standards: DevCenterStandards): boolean {
  if (["main", "master", "develop", "dev", "trunk"].includes(branch)) {
    return true;
  }

  return Object.values(standards.branch_naming).some((template) => templateToRegex(template).test(branch));
}

function buildComplianceIssues(input: {
  repoPath: string;
  isRepo: boolean;
  documents: ProjectDocument[];
  metadataExists: boolean;
  tasksExists: boolean;
  currentBranch?: string;
  standards: DevCenterStandards;
}): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const docsByRelativePath = new Map(input.documents.map((doc) => [doc.relativePath, doc]));

  if (!input.isRepo) {
    issues.push({
      severity: "warning",
      code: "not-git-repo",
      message: "Directory is not a git repository."
    });
  }

  for (const requiredFile of input.standards.required_files) {
    if (["README.md", "README", "AGENTS.md"].includes(requiredFile)) {
      continue;
    }

    const stats = docsByRelativePath.get(requiredFile);
    if (!stats?.exists) {
      issues.push({
        severity: "warning",
        code: "required-file-missing",
        message: `Missing required file: ${requiredFile}`,
        file: requiredFile
      });
    }
  }

  const readme = input.documents.find((doc) => doc.key === "readme");
  if (!readme?.exists) {
    issues.push({
      severity: "warning",
      code: "readme-missing",
      message: "Missing README.",
      file: "README.md"
    });
  } else if (readme.empty) {
    issues.push({
      severity: "warning",
      code: "readme-empty",
      message: "README exists but is empty.",
      file: readme.relativePath
    });
  }

  const agents = input.documents.find((doc) => doc.key === "agents");
  if (!agents?.exists) {
    issues.push({
      severity: "info",
      code: "agents-missing",
      message: "Optional agent instructions are missing.",
      file: "AGENTS.md",
      optional: true
    });
  }

  if (!input.metadataExists) {
    issues.push({
      severity: "info",
      code: "metadata-missing",
      message: "Optional DevCenter metadata is missing.",
      file: ".devcenter/project.yaml",
      optional: true
    });
  }

  if (!input.tasksExists) {
    issues.push({
      severity: "info",
      code: "tasks-missing",
      message: "Optional DevCenter tasks metadata is missing.",
      file: ".devcenter/tasks.yaml",
      optional: true
    });
  }

  if (input.currentBranch && !branchNameIsAllowed(input.currentBranch, input.standards)) {
    issues.push({
      severity: "info",
      code: "branch-naming",
      message: `Current branch "${input.currentBranch}" does not match configured branch naming standards.`
    });
  }

  return issues;
}

function buildAttention(project: {
  git: ProjectSummary["git"];
  metadataExists: boolean;
  documents: ProjectDocument[];
  compliance: ComplianceIssue[];
  tasks: ProjectTask[];
}): string[] {
  const attention = new Set<string>();

  if (project.git.dirty) {
    attention.add("dirty");
  }

  if (!project.git.isRepo) {
    attention.add("not repo");
  }

  if (project.git.stashCount > 0) {
    attention.add("stashes");
  }

  if ((project.git.ahead ?? 0) > 0) {
    attention.add("unpushed");
  }

  if (project.git.remoteCount === 0) {
    attention.add("no remote");
  }

  const readme = project.documents.find((doc) => doc.key === "readme");
  if (!readme?.exists || readme.empty) {
    attention.add("missing docs");
  }

  if (project.compliance.some((issue) => !issue.optional && (issue.severity === "warning" || issue.severity === "error"))) {
    attention.add("standards");
  }

  if (project.tasks.some((task) => task.status === "blocked")) {
    attention.add("blocked task");
  }

  return [...attention];
}

// Path shown on the board: relative to the scan root, or "~/..." for extra
// projects that live outside it, so they don't render as "../../x".
export function displayPath(scanRoot: string, repoPath: string): string {
  const relative = path.relative(scanRoot, repoPath);
  if (!relative) {
    return ".";
  }

  if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    return relative;
  }

  const home = os.homedir();
  return repoPath.startsWith(`${home}${path.sep}`) ? `~/${path.relative(home, repoPath)}` : repoPath;
}

export function projectId(projectPath: string): string {
  return Buffer.from(projectPath).toString("base64url");
}

function emptyGitState(): GitState {
  return {
    isRepo: false,
    localBranches: [],
    remoteBranches: [],
    worktrees: [],
    stashes: [],
    dirtyFiles: [],
    graph: [],
    localBranchCount: 0,
    remoteBranchCount: 0,
    branchCount: 0,
    staleBranchCount: 0,
    orphanBranchCount: 0,
    worktreeCount: 0,
    stashCount: 0,
    dirty: false,
    uncommittedCount: 0,
    untrackedCount: 0,
    hasUpstream: false,
    remoteCount: 0,
    lastCommit: {},
    errors: []
  };
}

const DIRTY_FILE_STAT_LIMIT = 100;

/**
 * The most recent moment work happened in this checkout: the newest dirty-file
 * mtime (uncommitted work in progress) or the newest commit on any local
 * branch. Deterministic filesystem/git reads only.
 */
async function latestChange(repoPath: string, git: GitState): Promise<string | undefined> {
  const timestamps: number[] = [];

  const commitDates = [git.lastCommit.date, ...git.localBranches.map((branch) => branch.lastCommitDate)];
  for (const date of commitDates) {
    const parsed = date ? Date.parse(date) : Number.NaN;
    if (Number.isFinite(parsed)) {
      timestamps.push(parsed);
    }
  }

  const dirtyStats = await Promise.all(
    (git.dirtyFiles ?? [])
      .slice(0, DIRTY_FILE_STAT_LIMIT)
      .map((file) => statOptional(path.join(repoPath, file.path)))
  );
  for (const stats of dirtyStats) {
    if (stats) {
      timestamps.push(stats.mtime.getTime());
    }
  }

  if (timestamps.length === 0) {
    return undefined;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

export async function collectProject(
  repoPath: string,
  scanRoot: string,
  standards: DevCenterStandards,
  isRepo = true
): Promise<ProjectSummary> {
  const [git, metadataResult, taskResult, branchIntentResult, baseDocuments, archDocs, repoStats, contextStats, agentLogStats] =
    await Promise.all([
      isRepo ? collectGitState(repoPath) : Promise.resolve(emptyGitState()),
      readMetadata(repoPath),
      readTasks(repoPath),
      readBranchIntents(repoPath),
      Promise.all(knownDocuments.map((entry) => firstExistingDocument(repoPath, entry))),
      architectureDocuments(repoPath),
      statOptional(repoPath),
      statOptional(path.join(repoPath, ".devcenter", "context.md")),
      statOptional(path.join(repoPath, ".devcenter", "agent-log.md"))
    ]);

  const lastChange = git.isRepo ? await latestChange(repoPath, git) : repoStats?.mtime.toISOString();

  const documents = [...baseDocuments, ...archDocs];
  const compliance = buildComplianceIssues({
    repoPath,
    isRepo,
    documents,
    metadataExists: metadataResult.exists,
    tasksExists: taskResult.exists,
    currentBranch: git.currentBranch,
    standards
  });

  for (const [file, parseError] of [
    [".devcenter/project.yaml", metadataResult.parseError],
    [".devcenter/tasks.yaml", taskResult.parseError],
    [".devcenter/branches.yaml", branchIntentResult.parseError]
  ] as const) {
    if (parseError) {
      compliance.unshift({ severity: "error", code: "unreadable-yaml", message: `${file} is not valid YAML: ${parseError}`, file });
    }
  }

  const summary: ProjectSummary = {
    id: projectId(repoPath),
    name: metadataResult.metadata.name ?? path.basename(repoPath),
    path: repoPath,
    relativePath: displayPath(scanRoot, repoPath),
    status: metadataResult.metadata.status ?? (!git.isRepo ? "not_repo" : git.dirty ? "active" : "quiet"),
    lastModified: repoStats?.mtime.toISOString(),
    lastChange,
    metadata: metadataResult.metadata,
    metadataExists: metadataResult.exists,
    tasks: taskResult.tasks,
    taskCounts: countTasks(taskResult.tasks),
    branchIntents: branchIntentResult.intents,
    branchIntentsExist: branchIntentResult.exists,
    documents,
    contextUpdatedAt: contextStats?.mtime.toISOString(),
    lastAiUpdate: agentLogStats?.mtime.toISOString(),
    git,
    compliance,
    attention: []
  };

  summary.attention = buildAttention(summary);
  return summary;
}

export async function readProjectDocument(repoPath: string, relativePath: string): Promise<string> {
  const resolved = path.resolve(repoPath, relativePath);
  const root = path.resolve(repoPath);

  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    throw new Error("Document path escapes project root.");
  }

  const stats = await fs.stat(resolved);
  if (!stats.isFile()) {
    throw new Error("Document path is not a file.");
  }

  if (stats.size > 1024 * 1024) {
    throw new Error("Document is larger than the 1 MB preview limit.");
  }

  return fs.readFile(resolved, "utf8");
}
