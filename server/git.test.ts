import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAheadBehind,
  parseBranchCommits,
  parseDirtyFiles,
  parseGitGraph,
  parseLocalBranches,
  parseRemoteBranches,
  parseStashes,
  parseWorktrees
} from "./git";

test("parseLocalBranches includes upstream tracking and last commit dates", () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-30T00:00:00+00:00");

  try {
    const branches = parseLocalBranches(
      [
        "feature/git-detail\torigin/feature/git-detail\t2026-05-29T12:00:00+00:00\t[ahead 2, behind 1]",
        "main\torigin/main\t2026-05-28T10:00:00+00:00\t",
        "scratch\t\t2026-04-01T09:30:00+00:00\t"
      ].join("\n")
    );

    assert.deepEqual(branches, [
      {
        name: "feature/git-detail",
        upstream: "origin/feature/git-detail",
        ahead: 2,
        behind: 1,
        lastCommitDate: "2026-05-29T12:00:00+00:00",
        stale: false
      },
      {
        name: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        lastCommitDate: "2026-05-28T10:00:00+00:00",
        stale: false
      },
      {
        name: "scratch",
        lastCommitDate: "2026-04-01T09:30:00+00:00",
        stale: false
      }
    ]);
  } finally {
    Date.now = originalDateNow;
  }
});

test("parseRemoteBranches skips remote HEAD aliases", () => {
  assert.deepEqual(
    parseRemoteBranches(
      ["origin/HEAD\t2026-05-29T12:00:00+00:00\t1111111", "origin/main\t2026-05-29T12:00:00+00:00\t2222222"].join("\n")
    ),
    [
      {
        name: "origin/main",
        lastCommitDate: "2026-05-29T12:00:00+00:00",
        head: "2222222"
      }
    ]
  );
});

test("parseWorktrees reads porcelain worktree blocks", () => {
  const worktrees = parseWorktrees(
    [
      "worktree /Users/brandon/dev/app",
      "HEAD abcdef123456",
      "branch refs/heads/main",
      "",
      "worktree /Users/brandon/dev/app-linked",
      "HEAD 999999999999",
      "detached"
    ].join("\n")
  );

  assert.deepEqual(worktrees, [
    {
      path: "/Users/brandon/dev/app",
      head: "abcdef123456",
      branch: "main"
    },
    {
      path: "/Users/brandon/dev/app-linked",
      head: "999999999999"
    }
  ]);
});

test("parseStashes extracts index, hash, date, and tab-safe message", () => {
  assert.deepEqual(parseStashes("stash@{0}\tabcd123\t2026-05-29T12:00:00+00:00\tWIP on main\tkeep tab"), [
    {
      name: "stash@{0}",
      index: 0,
      hash: "abcd123",
      date: "2026-05-29T12:00:00+00:00",
      message: "WIP on main\tkeep tab"
    }
  ]);
});

test("parseDirtyFiles reads porcelain v1 z output including renames", () => {
  assert.deepEqual(parseDirtyFiles(" M src/App.tsx\0?? notes.md\0R  src/new.ts\0src/old.ts\0"), [
    {
      status: " M",
      path: "src/App.tsx"
    },
    {
      status: "??",
      path: "notes.md"
    },
    {
      status: "R ",
      path: "src/new.ts",
      originalPath: "src/old.ts"
    }
  ]);
});

test("parseAheadBehind preserves missing upstream state", () => {
  assert.deepEqual(parseAheadBehind(undefined), { hasUpstream: false });
  assert.deepEqual(parseAheadBehind("3 2"), { ahead: 2, behind: 3, hasUpstream: true });
});

test("parseBranchCommits reads NUL-separated records with shortstat lines", () => {
  const log = [
    "\0",
    "1111111111111111111111111111111111111111\t1111111\t2026-06-10T09:00:00+00:00\tBrandon\tAdd branch map\n",
    " 3 files changed, 40 insertions(+), 2 deletions(-)\n",
    "\0",
    "2222222222222222222222222222222222222222\t2222222\t2026-06-09T09:00:00+00:00\tBrandon\tMerge branch 'main'\n",
    "\0",
    "3333333333333333333333333333333333333333\t3333333\t2026-06-08T09:00:00+00:00\tBrandon\tRemove legacy page\n",
    " 1 file changed, 12 deletions(-)\n"
  ].join("");

  assert.deepEqual(parseBranchCommits(log), [
    {
      hash: "1111111111111111111111111111111111111111",
      shortHash: "1111111",
      date: "2026-06-10T09:00:00+00:00",
      author: "Brandon",
      subject: "Add branch map",
      filesChanged: 3,
      insertions: 40,
      deletions: 2
    },
    {
      hash: "2222222222222222222222222222222222222222",
      shortHash: "2222222",
      date: "2026-06-09T09:00:00+00:00",
      author: "Brandon",
      subject: "Merge branch 'main'"
    },
    {
      hash: "3333333333333333333333333333333333333333",
      shortHash: "3333333",
      date: "2026-06-08T09:00:00+00:00",
      author: "Brandon",
      subject: "Remove legacy page",
      filesChanged: 1,
      insertions: undefined,
      deletions: 12
    }
  ]);
});

test("parseBranchCommits returns nothing for empty or malformed output", () => {
  assert.deepEqual(parseBranchCommits(undefined), []);
  assert.deepEqual(parseBranchCommits(""), []);
  assert.deepEqual(parseBranchCommits("\0not-a-commit-record"), []);
});

test("parseGitGraph extracts lane text, refs, and commit metadata", () => {
  assert.deepEqual(
    parseGitGraph(
      [
        "*   1111111111111111111111111111111111111111\t1111111\taaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\t2026-05-30T00:00:00+00:00\tBrandon\tHEAD -> feature/tree, origin/feature/tree\tMerge branch",
        "| * 2222222222222222222222222222222222222222\t2222222\t1111111111111111111111111111111111111111\t2026-05-29T00:00:00+00:00\tBrandon\torigin/main, main\tUpdate dashboard"
      ].join("\n")
    ),
    [
      {
        hash: "1111111111111111111111111111111111111111",
        shortHash: "1111111",
        parents: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
        date: "2026-05-30T00:00:00+00:00",
        author: "Brandon",
        refs: ["HEAD -> feature/tree", "origin/feature/tree"],
        subject: "Merge branch",
        graph: "*",
        head: true
      },
      {
        hash: "2222222222222222222222222222222222222222",
        shortHash: "2222222",
        parents: ["1111111111111111111111111111111111111111"],
        date: "2026-05-29T00:00:00+00:00",
        author: "Brandon",
        refs: ["origin/main", "main"],
        subject: "Update dashboard",
        graph: "| *",
        head: false
      }
    ]
  );
});
