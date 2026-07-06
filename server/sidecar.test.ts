import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  attachSidecar,
  commitSidecar,
  detachSidecar,
  doctorSidecar,
  statusSidecar
} from "./sidecar";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

async function makeDevCenterRoot(root: string): Promise<string> {
  const devcenter = path.join(root, "Private DevCenter");
  await fs.mkdir(devcenter, { recursive: true });
  await git(devcenter, ["init"]);
  await git(devcenter, ["config", "user.name", "DevCenter Test"]);
  await git(devcenter, ["config", "user.email", "devcenter@example.com"]);
  await fs.writeFile(path.join(devcenter, "README.md"), "# Private DevCenter\n", "utf8");
  await git(devcenter, ["add", "README.md"]);
  await git(devcenter, ["commit", "-m", "init"]);
  return devcenter;
}

test("attach creates ignored sidecar symlinks and keeps project repo clean", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-sidecar-"));
  const devcenter = await makeDevCenterRoot(root);
  const project = await makeGitRepo(root, "My App");

  const result = await attachSidecar(project, devcenter);

  assert.equal(result.projectName, "My App");
  assert.equal((await fs.lstat(path.join(project, "AGENTS.md"))).isSymbolicLink(), true);
  assert.equal((await fs.lstat(path.join(project, ".devcenter"))).isSymbolicLink(), true);
  assert.match(await fs.readFile(path.join(project, ".git", "info", "exclude"), "utf8"), /^AGENTS\.md$/m);
  assert.match(await fs.readFile(path.join(project, ".git", "info", "exclude"), "utf8"), /^\.devcenter\/$/m);
  assert.match(await fs.readFile(path.join(project, ".git", "info", "exclude"), "utf8"), /^\.devcenter$/m);
  assert.equal(await git(project, ["status", "--short"]), "");

  const taskFile = path.join(project, ".devcenter", "tasks.yaml");
  await fs.writeFile(taskFile, "- id: TASK-1\n  title: Local edit\n  status: next\n", "utf8");

  assert.equal(await git(project, ["status", "--short"]), "");
  assert.match(await git(devcenter, ["status", "--short", "--untracked-files=all"]), /projects\/My App\/\.devcenter\/tasks\.yaml/);
});

test("attach inside a linked worktree shares the main checkout's sidecar project", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-sidecar-"));
  const devcenter = await makeDevCenterRoot(root);
  const project = await makeGitRepo(root, "WorktreeApp");
  await attachSidecar(project, devcenter);

  const worktree = path.join(root, "WorktreeApp-thread");
  await git(project, ["worktree", "add", "-b", "feature/thread", worktree]);

  const result = await attachSidecar(worktree, devcenter);

  assert.equal(result.projectName, "WorktreeApp");
  assert.equal(result.storagePath, path.join(devcenter, "projects", "WorktreeApp"));
  assert.match(result.messages.join("\n"), /linked worktree of/);
  assert.equal((await fs.lstat(path.join(worktree, "AGENTS.md"))).isSymbolicLink(), true);
  assert.equal((await fs.lstat(path.join(worktree, "CLAUDE.md"))).isSymbolicLink(), true);
  assert.equal((await fs.lstat(path.join(worktree, ".devcenter"))).isSymbolicLink(), true);
  assert.equal(await git(worktree, ["status", "--short"]), "");
  await assert.rejects(fs.stat(path.join(devcenter, "projects", "WorktreeApp-thread")), /ENOENT/);
});

test("attach from a subdirectory places links at the checkout root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-sidecar-"));
  const devcenter = await makeDevCenterRoot(root);
  const project = await makeGitRepo(root, "SubdirApp");
  const subdir = path.join(project, "nested", "deep");
  await fs.mkdir(subdir, { recursive: true });

  const result = await attachSidecar(subdir, devcenter);

  assert.equal(result.projectName, "SubdirApp");
  assert.equal(result.projectPath, await fs.realpath(project));
  assert.equal((await fs.lstat(path.join(project, "AGENTS.md"))).isSymbolicLink(), true);
  await assert.rejects(fs.lstat(path.join(subdir, "AGENTS.md")), /ENOENT/);
});

test("devcenter bin resolves its TypeScript loader outside the DevCenter repo", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-bin-"));
  const { stdout } = await execFileAsync(path.join(repoRoot, "scripts", "devcenter.mjs"), ["--help"], {
    cwd: root
  });

  assert.match(stdout, /Usage: devcenter <command>/);
});

test("status reports link state, sidecar changes, and tracked memory warnings", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-sidecar-"));
  const devcenter = await makeDevCenterRoot(root);
  const project = await makeGitRepo(root, "TrackedApp");
  await fs.mkdir(path.join(project, ".devcenter"));
  await fs.writeFile(path.join(project, "AGENTS.md"), "# Existing\n", "utf8");
  await fs.writeFile(path.join(project, ".devcenter", "project.yaml"), "name: TrackedApp\n", "utf8");
  await git(project, ["add", "AGENTS.md", ".devcenter/project.yaml"]);
  await git(project, ["commit", "-m", "track memory"]);

  await attachSidecar(project, devcenter);
  const status = await statusSidecar(project, devcenter);

  assert.equal(status.exitCode, 0);
  assert.equal(status.agents.isSymlink, false);
  assert.equal(status.devcenter.isSymlink, false);
  assert.deepEqual(status.projectTracked.sort(), [".devcenter/project.yaml", "AGENTS.md"]);
  assert.match(status.warnings.join("\n"), /git rm -r --cached/);
});

test("status exits nonzero for missing required links", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-sidecar-"));
  const devcenter = await makeDevCenterRoot(root);
  const project = await makeGitRepo(root, "MissingLinks");

  const status = await statusSidecar(project, devcenter);

  assert.equal(status.exitCode, 1);
  assert.equal(status.agents.exists, false);
  assert.equal(status.devcenter.exists, false);
});

test("doctor repairs missing symlinks, excludes, and sidecar files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-sidecar-"));
  const devcenter = await makeDevCenterRoot(root);
  const project = await makeGitRepo(root, "DoctorApp");

  const result = await doctorSidecar(project, devcenter);
  const status = await statusSidecar(project, devcenter);

  assert.equal(status.exitCode, 0);
  assert.equal(status.agents.expected, true);
  assert.equal(status.devcenter.expected, true);
  assert.equal(status.excludeEntries["AGENTS.md"], true);
  assert.equal(status.excludeEntries[".devcenter"], true);
  assert.equal(await git(project, ["status", "--short"]), "");
  assert.match(result.messages.join("\n"), /created projects\/DoctorApp\/AGENTS\.md/);
});

test("detach removes symlinks and optionally cleans exclude entries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-sidecar-"));
  const devcenter = await makeDevCenterRoot(root);
  const project = await makeGitRepo(root, "DetachApp");

  await attachSidecar(project, devcenter);
  await detachSidecar(project, { devcenterRoot: devcenter, cleanExclude: true });

  await assert.rejects(fs.lstat(path.join(project, "AGENTS.md")), /ENOENT/);
  await assert.rejects(fs.lstat(path.join(project, ".devcenter")), /ENOENT/);
  const exclude = await fs.readFile(path.join(project, ".git", "info", "exclude"), "utf8");
  assert.doesNotMatch(exclude, /^AGENTS\.md$/m);
  assert.doesNotMatch(exclude, /^\.devcenter\/$/m);
  assert.equal(await fs.stat(path.join(devcenter, "projects", "DetachApp", "AGENTS.md")).then((stats) => stats.isFile()), true);
});

test("commit stages and commits only the matching sidecar project", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-sidecar-"));
  const devcenter = await makeDevCenterRoot(root);
  const project = await makeGitRepo(root, "CommitApp");
  const other = await makeGitRepo(root, "OtherApp");

  await attachSidecar(project, devcenter);
  await attachSidecar(other, devcenter);
  await fs.writeFile(path.join(other, ".devcenter", "tasks.yaml"), "- id: OTHER\n  title: Other change\n  status: next\n", "utf8");

  const result = await commitSidecar(project, "update CommitApp memory", devcenter);
  const committedFiles = await git(devcenter, ["show", "--name-only", "--format=", "HEAD"]);

  assert.match(result.messages.join("\n"), /update CommitApp memory/);
  assert.match(committedFiles, /projects\/CommitApp\/AGENTS\.md/);
  assert.doesNotMatch(committedFiles, /projects\/OtherApp/);
  assert.match(await git(devcenter, ["status", "--short"]), /\?\? projects\/OtherApp\//);

  const noChanges = await commitSidecar(project, "update CommitApp memory", devcenter);
  assert.deepEqual(noChanges.messages, ["No changes to commit for CommitApp."]);
});
