import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import YAML from "yaml";
import { updateProjectTask } from "./devcenter";

const tempRoots: string[] = [];

async function makeProject(tasks: unknown[]): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-tasks-"));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, ".devcenter"), { recursive: true });
  await fs.writeFile(path.join(root, ".devcenter", "tasks.yaml"), YAML.stringify(tasks), "utf8");
  return root;
}

async function readRawTasks(root: string): Promise<Record<string, unknown>[]> {
  const raw = await fs.readFile(path.join(root, ".devcenter", "tasks.yaml"), "utf8");
  return YAML.parse(raw) as Record<string, unknown>[];
}

after(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("updateProjectTask", () => {
  it("updates provided fields and returns the normalized list", async () => {
    const root = await makeProject([
      { id: "AB-001", title: "First", status: "backlog", priority: "medium" },
      { id: "AB-002", title: "Second", status: "next" }
    ]);

    const tasks = await updateProjectTask(root, "AB-002", { status: "in_progress", priority: "high", notes: "Started." });

    const updated = tasks.find((task) => task.id === "AB-002");
    assert.equal(updated?.status, "in_progress");
    assert.equal(updated?.priority, "high");
    assert.equal(updated?.notes, "Started.");

    const untouched = tasks.find((task) => task.id === "AB-001");
    assert.equal(untouched?.status, "backlog");
  });

  it("preserves fields the app does not model", async () => {
    const root = await makeProject([
      { id: "AB-001", title: "First", status: "backlog", created: "2026-01-01", source: "codex" }
    ]);

    await updateProjectTask(root, "AB-001", { status: "done" });

    const raw = await readRawTasks(root);
    assert.equal(raw[0].created, "2026-01-01");
    assert.equal(raw[0].source, "codex");
    assert.equal(raw[0].status, "done");
  });

  it("matches task ids case-insensitively", async () => {
    const root = await makeProject([{ id: "AB-001", title: "First", status: "backlog" }]);

    const tasks = await updateProjectTask(root, "ab-001", { title: "Renamed" });

    assert.equal(tasks[0].title, "Renamed");
  });

  it("rejects unknown statuses", async () => {
    const root = await makeProject([{ id: "AB-001", title: "First", status: "backlog" }]);

    await assert.rejects(() => updateProjectTask(root, "AB-001", { status: "someday" }), /Unknown status/);
  });

  it("rejects empty titles", async () => {
    const root = await makeProject([{ id: "AB-001", title: "First", status: "backlog" }]);

    await assert.rejects(() => updateProjectTask(root, "AB-001", { title: "   " }), /cannot be empty/);
  });

  it("rejects unknown task ids", async () => {
    const root = await makeProject([{ id: "AB-001", title: "First", status: "backlog" }]);

    await assert.rejects(() => updateProjectTask(root, "AB-999", { status: "done" }), /No task with id/);
  });

  it("rejects projects without a tasks file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "devcenter-tasks-"));
    tempRoots.push(root);

    await assert.rejects(() => updateProjectTask(root, "AB-001", { status: "done" }), /no \.devcenter\/tasks\.yaml/);
  });
});
