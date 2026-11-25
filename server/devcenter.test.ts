import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultStandards } from "./config";
import { collectProject, displayPath, normalizeBranchIntents } from "./devcenter";

test("displayPath stays relative inside the scan root and uses ~ outside it", () => {
  const home = os.homedir();
  const scanRoot = path.join(home, "dev");

  assert.equal(displayPath(scanRoot, scanRoot), ".");
  assert.equal(displayPath(scanRoot, path.join(scanRoot, "group", "app")), path.join("group", "app"));
  assert.equal(displayPath(scanRoot, path.join(home, ".config-repo")), "~/.config-repo");
  assert.equal(displayPath(scanRoot, "/opt/elsewhere"), "/opt/elsewhere");
});

test("collectProject reports an unparseable tasks.yaml instead of throwing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-collect-"));
  const project = path.join(root, "app");
  await fs.mkdir(path.join(project, ".devcenter"), { recursive: true });
  // A plain scalar that hits " #" and then dedents: the shape agents produce.
  await fs.writeFile(
    path.join(project, ".devcenter", "tasks.yaml"),
    "- id: A-001\n  title: First\n  notes: sits on a #1d1d1f tile\n to the banner\n",
    "utf8"
  );

  const summary = await collectProject(project, root, defaultStandards, false);
  assert.deepEqual(summary.tasks, []);
  const issue = summary.compliance.find((candidate) => candidate.code === "unreadable-yaml");
  assert.ok(issue, "expected an unreadable-yaml issue");
  assert.equal(issue.file, ".devcenter/tasks.yaml");
  assert.equal(issue.severity, "error");
});

test("normalizeBranchIntents reads the branches map form", () => {
  const intents = normalizeBranchIntents({
    version: 1,
    branches: {
      main: {
        role: "deployed",
        status: "protected",
        purpose: "Production branch.",
        notes: ["Do not use for rewrite work."]
      },
      "v2-astro": {
        role: "rewrite",
        status: "active",
        parent: "main",
        worktree: "/tmp/worktrees/v2-astro"
      }
    }
  });

  assert.deepEqual(intents, [
    {
      name: "main",
      role: "deployed",
      status: "protected",
      parent: undefined,
      purpose: "Production branch.",
      worktree: undefined,
      notes: ["Do not use for rewrite work."]
    },
    {
      name: "v2-astro",
      role: "rewrite",
      status: "active",
      parent: "main",
      purpose: undefined,
      worktree: "/tmp/worktrees/v2-astro",
      notes: []
    }
  ]);
});

test("normalizeBranchIntents reads the array form and drops nameless entries", () => {
  const intents = normalizeBranchIntents([
    { name: "main", role: "deployed" },
    { role: "rewrite" },
    "not-an-object"
  ]);

  assert.deepEqual(
    intents.map((intent) => intent.name),
    ["main"]
  );
});

test("normalizeBranchIntents tolerates missing or malformed files", () => {
  assert.deepEqual(normalizeBranchIntents(undefined), []);
  assert.deepEqual(normalizeBranchIntents("main"), []);
  assert.deepEqual(normalizeBranchIntents({ branches: "main" }), []);
});
