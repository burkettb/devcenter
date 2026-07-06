import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { attachSidecar } from "./sidecar";
import { addTask, appendAgentLog, listProjects, listTasks, setTaskStatus, syncMemory } from "./memory";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function makeGitRepo(root: string, name: string): Promise<string> {
  const repo = path.join(root, name);
  await fs.mkdir(repo, { recursive: true });
  await git(repo, ["init"]);
  await git(repo, ["config", "user.name", "DevCenter Test"]);
  await git(repo, ["config", "user.email", "devcenter@example.com"]);
  await fs.writeFile(path.join(repo, "README.md"), `# ${name}\n`, "utf8");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "init"]);
  return repo;
}

async function makeWorkspace(): Promise<{ root: string; devcenter: string; project: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-memory-"));
  const devcenter = await makeGitRepo(root, "devcenter");
  const project = await makeGitRepo(root, "My App");
  await attachSidecar(project, devcenter);
  return { root, devcenter, project };
}

test("task add, list, and status transitions round-trip through tasks.yaml", async () => {
  const { devcenter, project } = await makeWorkspace();

  const added = await addTask(project, "Ship the feature", { priority: "high" }, devcenter);
  assert.match(added.messages[0], /added \[backlog\] MA-001 Ship the feature \(high\)/);

  await addTask(project, "Second task", {}, devcenter);
  const listed = await listTasks(project, devcenter);
  assert.equal(listed.messages.length, 2);

  const started = await setTaskStatus(project, "ma-001", "in_progress", devcenter);
  assert.match(started.messages[0], /\[in_progress\] MA-001/);

  const done = await setTaskStatus(project, "MA-001", "done", devcenter);
  assert.match(done.messages[0], /\[done\]/);

  const after = await listTasks(project, devcenter);
  assert.match(after.messages.join("\n"), /MA-002 Second task/);
  assert.match(after.messages.join("\n"), /\(1 done\)/);

  const raw = await fs.readFile(path.join(devcenter, "projects", "My App", ".devcenter", "tasks.yaml"), "utf8");
  assert.match(raw, /Done \d{4}-\d{2}-\d{2}\./);

  await assert.rejects(setTaskStatus(project, "MA-999", "done", devcenter), /No task with id/);
  await assert.rejects(setTaskStatus(project, "MA-002", "bogus", devcenter), /Unknown status/);
});

test("log appends dated entries and groups same-day notes under one heading", async () => {
  const { devcenter, project } = await makeWorkspace();

  await appendAgentLog(project, "First note", devcenter);
  await appendAgentLog(project, "Second note", devcenter);

  const log = await fs.readFile(path.join(devcenter, "projects", "My App", ".devcenter", "agent-log.md"), "utf8");
  const today = new Date().toISOString().slice(0, 10);
  const headings = log.split("\n").filter((line) => line === `## ${today}`);
  assert.equal(headings.length, 1);
  assert.match(log, /- First note\n- Second note\n$/);
});

test("list summarizes attached projects with task counts", async () => {
  const { devcenter, project } = await makeWorkspace();
  await addTask(project, "Open work", {}, devcenter);
  await addTask(project, "Blocked work", { status: "blocked" }, devcenter);

  const listed = await listProjects(devcenter);
  assert.equal(listed.messages.length, 1);
  assert.match(listed.messages[0], /My App/);
  assert.match(listed.messages[0], /2 open \(1 blocked\), 0 done/);
});

test("sync commits memory changes and warns when no remote exists", async () => {
  const { devcenter, project } = await makeWorkspace();
  await addTask(project, "Sync me", {}, devcenter);

  const synced = await syncMemory(devcenter);
  assert.match(synced.messages[0], /sync project memory/);
  assert.match(synced.warnings[0], /No origin remote/);

  const status = await git(devcenter, ["status", "--short", "--", "projects", "standards"]);
  assert.equal(status, "");

  const again = await syncMemory(devcenter);
  assert.match(again.messages[0], /No memory changes/);
});

test("attach links CLAUDE.md and materializes merged global standards in the sidecar", async () => {
  const { devcenter, project } = await makeWorkspace();

  const claude = await fs.lstat(path.join(project, "CLAUDE.md"));
  assert.equal(claude.isSymbolicLink(), true);
  assert.equal(
    await fs.readFile(path.join(project, "CLAUDE.md"), "utf8"),
    await fs.readFile(path.join(project, "AGENTS.md"), "utf8")
  );

  // The snapshot is a generated regular file merging the app repo's defaults
  // with the home repo's overlay — not a symlink into the home repo.
  const snapshotStats = await fs.lstat(path.join(project, ".devcenter", "global-standards.yaml"));
  assert.equal(snapshotStats.isSymbolicLink(), false);
  const viaProject = await fs.readFile(path.join(project, ".devcenter", "global-standards.yaml"), "utf8");
  assert.match(viaProject, /Generated by devcenter/);
  assert.match(viaProject, /branch_naming/);

  const exclude = await fs.readFile(path.join(project, ".git", "info", "exclude"), "utf8");
  assert.match(exclude, /^CLAUDE\.md$/m);
});
