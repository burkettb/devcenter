import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { collapseSharedSidecars, discoverProjects, withExtraProjects } from "./discovery";

async function mkdirp(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
}

test("discoverProjects includes direct non-repo directories and nested repos", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-discovery-"));
  await mkdirp(path.join(root, "app", ".git"));
  await mkdirp(path.join(root, "group", "nested-app", ".git"));
  await mkdirp(path.join(root, "notes"));

  const projects = await discoverProjects(root, 3);
  const relative = projects.map((project) => ({
    path: path.relative(root, project.path),
    isRepo: project.isRepo
  }));

  assert.deepEqual(relative, [
    { path: "app", isRepo: true },
    { path: "group", isRepo: false },
    { path: path.join("group", "nested-app"), isRepo: true },
    { path: "notes", isRepo: false }
  ]);
});

test("discoverProjects skips excluded root subdirectories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-discovery-"));
  await mkdirp(path.join(root, "active", ".git"));
  await mkdirp(path.join(root, "archive", "old-app", ".git"));

  const projects = await discoverProjects(root, 3, ["archive"]);
  const relative = projects.map((project) => path.relative(root, project.path));

  assert.deepEqual(relative, ["active"]);
});

test("withExtraProjects adds dot-directories outside the scan root and drops missing or duplicate paths", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-discovery-"));
  const root = path.join(base, "dev");
  await mkdirp(path.join(root, "app", ".git"));
  await mkdirp(path.join(base, ".config-repo", ".git"));

  const discovered = await discoverProjects(root, 3);
  const projects = await withExtraProjects(discovered, [
    path.join(base, ".config-repo"),
    path.join(base, "missing"),
    path.join(root, "app")
  ]);

  assert.deepEqual(
    projects.map((project) => ({ path: path.relative(base, project.path), isRepo: project.isRepo })),
    [
      { path: ".config-repo", isRepo: true },
      { path: path.join("dev", "app"), isRepo: true }
    ]
  );
});

test("collapseSharedSidecars keeps one folder per linked sidecar", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-discovery-"));
  const home = path.join(base, "home", "projects");
  const root = path.join(base, "dev");
  await mkdirp(path.join(home, "app", ".devcenter"));
  await mkdirp(path.join(home, "tool", ".devcenter"));

  // app: main checkout plus a linked worktree (.git file).
  await mkdirp(path.join(root, "app", ".git"));
  await mkdirp(path.join(root, "app-feature"));
  await fs.writeFile(path.join(root, "app-feature", ".git"), "gitdir: ../app/.git/worktrees/app-feature\n");
  // tool: two separate clones; the one named like the sidecar wins.
  await mkdirp(path.join(root, "a-tool-copy", ".git"));
  await mkdirp(path.join(root, "tool", ".git"));
  // plain: no sidecar, always kept.
  await mkdirp(path.join(root, "plain", ".git"));

  for (const [folder, sidecar] of [["app", "app"], ["app-feature", "app"], ["a-tool-copy", "tool"], ["tool", "tool"]]) {
    await fs.symlink(path.join(home, sidecar, ".devcenter"), path.join(root, folder, ".devcenter"));
  }

  const projects = await collapseSharedSidecars(await discoverProjects(root, 3));

  assert.deepEqual(
    projects.map((project) => path.relative(root, project.path)),
    ["app", "plain", "tool"]
  );
});
