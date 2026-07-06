import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { discoverProjects } from "./discovery";

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
