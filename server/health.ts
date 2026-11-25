import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { taskStatuses, type TaskStatus } from "./memory";

// Read-only checks `devcenter doctor` reports on top of its link repairs.
// They flag problems; they never rewrite memory.

/** Problems an agent's hand edit can leave in tasks.yaml. */
export async function taskFileWarnings(tasksPath: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(tasksPath, "utf8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return [`tasks.yaml is not valid YAML, so the board and CLI cannot read it: ${reason}`];
  }

  if (parsed === null || parsed === undefined) {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return ["tasks.yaml is not a list of tasks."];
  }

  const unknown = parsed
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .filter((entry) => typeof entry.status === "string" && !taskStatuses.includes(entry.status as TaskStatus))
    .map((entry) => `${String(entry.id ?? "(no id)")}=${String(entry.status)}`);

  return unknown.length
    ? [`tasks.yaml has unknown statuses (${unknown.join(", ")}); the board shows them as backlog. Valid: ${taskStatuses.join(", ")}.`]
    : [];
}

/** Where Claude Code keeps auto-memory for a repo: <config>/projects/<path with non-alphanumerics as dashes>/memory. */
export function claudeAutoMemoryDir(projectRoot: string, configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude")): string {
  return path.join(configDir, "projects", projectRoot.replace(/[^a-zA-Z0-9]/g, "-"), "memory");
}

/**
 * Claude auto-memory notes typed `project` duplicate what the sidecar should hold
 * and go stale without anyone noticing. Count them so doctor can say so.
 */
export async function autoMemoryProjectNotes(memoryDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(memoryDir);
  } catch {
    return [];
  }

  const notes: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md") || name === "MEMORY.md") {
      continue;
    }
    const text = await fs.readFile(path.join(memoryDir, name), "utf8").catch(() => "");
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    if (/^\s*type:\s*project\s*$/m.test(frontmatter)) {
      notes.push(name);
    }
  }
  return notes.sort();
}

export async function autoMemoryWarnings(projectRoot: string, configDir?: string): Promise<string[]> {
  const dir = claudeAutoMemoryDir(projectRoot, configDir);
  const notes = await autoMemoryProjectNotes(dir);
  if (notes.length === 0) {
    return [];
  }

  return [
    `Claude auto-memory has ${notes.length} project note${notes.length === 1 ? "" : "s"} for this repo (${notes.join(", ")} in ${dir}). Move what is still true into .devcenter/context.md or decisions.md and delete the note.`
  ];
}
