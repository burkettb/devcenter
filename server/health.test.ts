import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { autoMemoryWarnings, claudeAutoMemoryDir, taskFileWarnings } from "./health";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("taskFileWarnings flags unparseable YAML and unknown statuses", async () => {
  const dir = await tempDir("devcenter-health-");
  const tasksPath = path.join(dir, "tasks.yaml");

  await fs.writeFile(tasksPath, "- id: A-001\n  title: ok\n  status: next\n", "utf8");
  assert.deepEqual(await taskFileWarnings(tasksPath), []);

  await fs.writeFile(tasksPath, "- id: A-001\n  title: x\n  status: pending\n- id: A-002\n  title: y\n  status: review\n- id: A-003\n  title: z\n  status: inbox\n", "utf8");
  const [unknown] = await taskFileWarnings(tasksPath);
  assert.match(unknown, /unknown statuses \(A-001=pending, A-002=review\)/);

  await fs.writeFile(tasksPath, "- id: A-001\n  notes: on a #1d1d1f tile\n to the banner\n", "utf8");
  const [broken] = await taskFileWarnings(tasksPath);
  assert.match(broken, /not valid YAML/);

  assert.deepEqual(await taskFileWarnings(path.join(dir, "missing.yaml")), []);
});

test("claudeAutoMemoryDir mirrors Claude Code's project folder naming", () => {
  assert.equal(claudeAutoMemoryDir("/Users/me/dev/my.app", "/cfg"), "/cfg/projects/-Users-me-dev-my-app/memory");
});

test("autoMemoryWarnings counts only project-typed notes", async () => {
  const configDir = await tempDir("devcenter-claude-");
  const memoryDir = claudeAutoMemoryDir("/repo/app", configDir);
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.writeFile(path.join(memoryDir, "MEMORY.md"), "- index\n", "utf8");
  await fs.writeFile(path.join(memoryDir, "arch.md"), "---\nname: arch\nmetadata:\n  type: project\n---\nbody\n", "utf8");
  await fs.writeFile(path.join(memoryDir, "prefs.md"), "---\nname: prefs\ntype: feedback\n---\nbody type: project\n", "utf8");

  const [warning] = await autoMemoryWarnings("/repo/app", configDir);
  assert.match(warning, /1 project note for this repo \(arch\.md in /);
  assert.deepEqual(await autoMemoryWarnings("/repo/other", configDir), []);
});
