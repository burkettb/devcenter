import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBranchIntents } from "./devcenter";

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
