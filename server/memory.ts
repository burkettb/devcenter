import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  createSidecarContext,
  defaultDevCenterRoot,
  runGit,
  type SidecarResult
} from "./sidecar";
import { refreshAllMaterializedStandards } from "./standards";

export const taskStatuses = ["backlog", "next", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export interface TaskRecord {
  id: string;
  title: string;
  status: string;
  priority: string;
  branch: string;
  notes: string;
}

export interface ProjectSummary {
  name: string;
  status: string;
  currentFocus: string;
  openTasks: number;
  blockedTasks: number;
  doneTasks: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function result(projectName: string, projectPath: string, storagePath: string, messages: string[], warnings: string[] = [], exitCode = 0): SidecarResult {
  return { projectName, projectPath, storagePath, messages, warnings, exitCode };
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
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

function normalizeTask(value: unknown): TaskRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  if (!title) {
    return undefined;
  }

  return {
    id: typeof record.id === "string" ? record.id : "",
    title,
    status: typeof record.status === "string" ? record.status : "backlog",
    priority: typeof record.priority === "string" ? record.priority : "medium",
    branch: typeof record.branch === "string" ? record.branch : "",
    notes: typeof record.notes === "string" ? record.notes : ""
  };
}

async function readTaskFile(tasksPath: string): Promise<TaskRecord[]> {
  const raw = await readTextIfExists(tasksPath);
  if (raw === undefined) {
    throw new Error(`No tasks file at ${tasksPath}. Run \`devcenter attach\` first.`);
  }

  const parsed = YAML.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map(normalizeTask).filter((task): task is TaskRecord => Boolean(task));
}

async function writeTaskFile(tasksPath: string, tasks: TaskRecord[]): Promise<void> {
  await fs.writeFile(tasksPath, YAML.stringify(tasks, { lineWidth: 100, minContentWidth: 0 }), "utf8");
}

function taskIdPrefix(projectName: string): string {
  const initials = projectName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return initials.slice(0, 4) || "TASK";
}

function nextTaskId(projectName: string, tasks: TaskRecord[]): string {
  const prefix = taskIdPrefix(projectName);
  let highest = 0;
  for (const task of tasks) {
    const match = /^(?:[A-Za-z]+)-(\d+)$/.exec(task.id);
    if (match) {
      highest = Math.max(highest, Number(match[1]));
    }
  }

  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}

function formatTask(task: TaskRecord): string {
  const parts = [`[${task.status}]`, task.id || "(no id)", task.title];
  if (task.priority && task.priority !== "medium") {
    parts.push(`(${task.priority})`);
  }
  return parts.join(" ");
}

export async function listTasks(projectPathInput = ".", devcenterRootInput?: string): Promise<SidecarResult> {
  const context = await createSidecarContext(projectPathInput, devcenterRootInput);
  const tasks = await readTaskFile(path.join(context.devcenterTarget, "tasks.yaml"));
  const open = tasks.filter((task) => task.status !== "done");
  const done = tasks.filter((task) => task.status === "done");
  const messages = open.length > 0 ? open.map(formatTask) : [`No open tasks for ${context.projectName}.`];
  if (done.length > 0) {
    messages.push(`(${done.length} done)`);
  }

  return result(context.projectName, context.projectPath, context.storagePath, messages);
}

export interface AddTaskOptions {
  priority?: string;
  status?: string;
  notes?: string;
  branch?: string;
}

export async function addTask(
  projectPathInput: string,
  title: string,
  options: AddTaskOptions = {},
  devcenterRootInput?: string
): Promise<SidecarResult> {
  if (!title.trim()) {
    throw new Error("Task title is required.");
  }

  const context = await createSidecarContext(projectPathInput, devcenterRootInput);
  const tasksPath = path.join(context.devcenterTarget, "tasks.yaml");
  const tasks = await readTaskFile(tasksPath);
  const status = options.status ?? "backlog";
  if (!taskStatuses.includes(status as TaskStatus)) {
    throw new Error(`Unknown status "${status}". Valid statuses: ${taskStatuses.join(", ")}.`);
  }

  const task: TaskRecord = {
    id: nextTaskId(context.projectName, tasks),
    title: title.trim(),
    status,
    priority: options.priority ?? "medium",
    branch: options.branch ?? "",
    notes: options.notes ?? ""
  };
  tasks.push(task);
  await writeTaskFile(tasksPath, tasks);

  return result(context.projectName, context.projectPath, context.storagePath, [`added ${formatTask(task)}`]);
}

export async function setTaskStatus(
  projectPathInput: string,
  taskId: string,
  status: string,
  devcenterRootInput?: string
): Promise<SidecarResult> {
  if (!taskStatuses.includes(status as TaskStatus)) {
    throw new Error(`Unknown status "${status}". Valid statuses: ${taskStatuses.join(", ")}.`);
  }

  const context = await createSidecarContext(projectPathInput, devcenterRootInput);
  const tasksPath = path.join(context.devcenterTarget, "tasks.yaml");
  const tasks = await readTaskFile(tasksPath);
  const task = tasks.find((candidate) => candidate.id.toLowerCase() === taskId.toLowerCase());
  if (!task) {
    throw new Error(`No task with id "${taskId}" in ${tasksPath}.`);
  }

  task.status = status;
  if (status === "done" && !task.notes.includes("Done ")) {
    task.notes = task.notes ? `${task.notes} Done ${today()}.` : `Done ${today()}.`;
  }
  await writeTaskFile(tasksPath, tasks);

  return result(context.projectName, context.projectPath, context.storagePath, [`updated ${formatTask(task)}`]);
}

export async function appendAgentLog(
  projectPathInput: string,
  message: string,
  devcenterRootInput?: string
): Promise<SidecarResult> {
  if (!message.trim()) {
    throw new Error("Log message is required.");
  }

  const context = await createSidecarContext(projectPathInput, devcenterRootInput);
  const logPath = path.join(context.devcenterTarget, "agent-log.md");
  const existing = await readTextIfExists(logPath);
  if (existing === undefined) {
    throw new Error(`No agent log at ${logPath}. Run \`devcenter attach\` first.`);
  }

  // The log is chronological and append-only, so today's entries are always at the end.
  const heading = `## ${today()}`;
  const base = existing.replace(/\n+$/, "");
  const entry = base.endsWith(heading) || base.includes(`${heading}\n`)
    ? `${base}\n- ${message.trim()}\n`
    : `${base}\n\n${heading}\n\n- ${message.trim()}\n`;
  await fs.writeFile(logPath, entry, "utf8");

  return result(context.projectName, context.projectPath, context.storagePath, [`logged to ${path.relative(context.devcenterRoot, logPath)}`]);
}

export async function listProjects(devcenterRootInput?: string): Promise<SidecarResult> {
  const devcenterRoot = path.resolve(devcenterRootInput ?? (await defaultDevCenterRoot()));
  const projectsRoot = path.join(devcenterRoot, "projects");
  const summaries: ProjectSummary[] = [];

  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const projectYaml = await readTextIfExists(path.join(projectsRoot, entry.name, ".devcenter", "project.yaml"));
    let status = "";
    let currentFocus = "";
    if (projectYaml) {
      try {
        const parsed = YAML.parse(projectYaml) as Record<string, unknown> | undefined;
        status = typeof parsed?.status === "string" ? parsed.status : "";
        currentFocus = typeof parsed?.current_focus === "string" ? parsed.current_focus : "";
      } catch {
        // Unreadable metadata should not hide the project from the list.
      }
    }

    let tasks: TaskRecord[] = [];
    try {
      tasks = await readTaskFile(path.join(projectsRoot, entry.name, ".devcenter", "tasks.yaml"));
    } catch {
      tasks = [];
    }

    summaries.push({
      name: entry.name,
      status,
      currentFocus,
      openTasks: tasks.filter((task) => task.status !== "done").length,
      blockedTasks: tasks.filter((task) => task.status === "blocked").length,
      doneTasks: tasks.filter((task) => task.status === "done").length
    });
  }

  const messages = summaries.length
    ? summaries.map((summary) => {
        const bits = [summary.name];
        if (summary.status) {
          bits.push(`[${summary.status}]`);
        }
        bits.push(`${summary.openTasks} open${summary.blockedTasks ? ` (${summary.blockedTasks} blocked)` : ""}, ${summary.doneTasks} done`);
        if (summary.currentFocus) {
          bits.push(`— ${summary.currentFocus}`);
        }
        return bits.join(" ");
      })
    : ["No projects attached yet. Run `devcenter attach` inside a project."];

  return result("", devcenterRoot, projectsRoot, messages);
}

export async function syncMemory(devcenterRootInput?: string, message?: string): Promise<SidecarResult> {
  const devcenterRoot = path.resolve(devcenterRootInput ?? (await defaultDevCenterRoot()));
  const messages: string[] = [];
  const warnings: string[] = [];
  const memoryPaths = ["projects", "standards"];

  // Re-materialize before committing so defaults/overlay edits reach every
  // project's snapshot in the same sync.
  const refreshed = await refreshAllMaterializedStandards(devcenterRoot);
  if (refreshed.length > 0) {
    messages.push(`refreshed ${refreshed.length} standards snapshot${refreshed.length === 1 ? "" : "s"}`);
  }

  const status = await runGit(devcenterRoot, ["status", "--short", "--untracked-files=all", "--", ...memoryPaths]);
  const dirty = status.code === 0 && status.stdout.trim().length > 0;

  if (dirty) {
    const add = await runGit(devcenterRoot, ["add", "--", ...memoryPaths]);
    if (add.code !== 0) {
      throw new Error(add.stderr || "git add failed");
    }

    const commit = await runGit(devcenterRoot, ["commit", "-m", message ?? `sync project memory ${today()}`, "--", ...memoryPaths]);
    if (commit.code !== 0) {
      throw new Error(commit.stderr || "git commit failed");
    }
    messages.push(commit.stdout.trim().split("\n")[0] || "Committed project memory.");
  } else {
    messages.push("No memory changes to commit.");
  }

  const remote = await runGit(devcenterRoot, ["remote", "get-url", "origin"]);
  if (remote.code !== 0) {
    warnings.push("No origin remote configured; skipped pull/push.");
    return result("", devcenterRoot, path.join(devcenterRoot, "projects"), messages, warnings);
  }

  const pull = await runGit(devcenterRoot, ["pull", "--rebase", "--autostash"]);
  if (pull.code !== 0) {
    throw new Error(pull.stderr || "git pull --rebase failed");
  }
  const pullSummary = pull.stdout.trim().split("\n").pop();
  if (pullSummary && !/up to date/i.test(pullSummary)) {
    messages.push(pullSummary);
  }

  const push = await runGit(devcenterRoot, ["push"]);
  if (push.code !== 0) {
    throw new Error(push.stderr || "git push failed");
  }
  messages.push("Pushed DevCenter memory.");

  return result("", devcenterRoot, path.join(devcenterRoot, "projects"), messages, warnings);
}
