import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type {
  BranchCommit,
  GitDirtyFile,
  GitGraphCommit,
  GitStashEntry,
  GitState,
  GitWorktree,
  LastCommit,
  LocalGitBranch,
  RemoteGitBranch
} from "../src/types";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15000;
const GIT_BIN = process.env.DEVCENTER_GIT_BIN ?? (existsSync("/usr/bin/git") ? "/usr/bin/git" : "git");
const GIT_DETAIL_LIMITS = {
  localBranches: 200,
  remoteBranches: 200,
  worktrees: 50,
  stashes: 50,
  dirtyFiles: 500,
  graphCommits: 120,
  branchCommits: 30
};

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(GIT_BIN, args, {
    cwd,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C"
    },
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024
  });

  return stdout.trim();
}

async function gitOptional(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await git(cwd, args);
    return result.length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

function lines(value?: string): string[] {
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

export function parseLastCommit(value?: string): LastCommit {
  if (!value) {
    return {};
  }

  const [date, author, subject, hash] = value.split("\t");
  return { date, author, subject, hash };
}

function countStatus(dirtyFiles: GitDirtyFile[]): { dirty: boolean; uncommittedCount: number; untrackedCount: number } {
  const untrackedCount = dirtyFiles.filter((file) => file.status === "??").length;
  const uncommittedCount = dirtyFiles.length - untrackedCount;

  return {
    dirty: dirtyFiles.length > 0,
    uncommittedCount,
    untrackedCount
  };
}

export function parseAheadBehind(value?: string): { ahead?: number; behind?: number; hasUpstream: boolean } {
  if (!value) {
    return { hasUpstream: false };
  }

  const [behind, ahead] = value.split(/\s+/).map((item) => Number(item));
  return {
    ahead: Number.isFinite(ahead) ? ahead : undefined,
    behind: Number.isFinite(behind) ? behind : undefined,
    hasUpstream: true
  };
}

function parseTrackValue(value?: string): { ahead?: number; behind?: number; gone: boolean } {
  if (!value) {
    return { gone: false };
  }

  const aheadMatch = value.match(/ahead (\d+)/);
  const behindMatch = value.match(/behind (\d+)/);

  return {
    ahead: aheadMatch ? Number(aheadMatch[1]) : undefined,
    behind: behindMatch ? Number(behindMatch[1]) : undefined,
    gone: value.includes("gone")
  };
}

export function parseLocalBranches(value?: string): LocalGitBranch[] {
  const staleBefore = Date.now() - 1000 * 60 * 60 * 24 * 90;

  return lines(value)
    .slice(0, GIT_DETAIL_LIMITS.localBranches)
    .map((line) => {
      const [name, upstream, lastCommitDate, track] = line.split("\t");
      const tracking = parseTrackValue(track);
      const branch: LocalGitBranch = { name };

      if (upstream) {
        branch.upstream = upstream;
        if (!tracking.gone) {
          branch.ahead = tracking.ahead ?? 0;
          branch.behind = tracking.behind ?? 0;
        }
      }

      if (lastCommitDate) {
        branch.lastCommitDate = lastCommitDate;
        branch.stale = Date.parse(lastCommitDate) < staleBefore;
      }

      return branch;
    })
    .filter((branch) => branch.name.length > 0);
}

export function parseRemoteBranches(value?: string): RemoteGitBranch[] {
  return lines(value)
    .slice(0, GIT_DETAIL_LIMITS.remoteBranches)
    .map((line) => {
      const [name, lastCommitDate, head] = line.split("\t");
      const branch: RemoteGitBranch = { name };

      if (lastCommitDate) {
        branch.lastCommitDate = lastCommitDate;
      }

      if (head) {
        branch.head = head;
      }

      return branch;
    })
    .filter((branch) => branch.name.length > 0 && !branch.name.endsWith("/HEAD"));
}

function shortBranchName(value: string): string {
  return value.startsWith("refs/heads/") ? value.slice("refs/heads/".length) : value;
}

export function parseWorktrees(value?: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let current: GitWorktree | undefined;

  function pushCurrent(): void {
    if (current && worktrees.length < GIT_DETAIL_LIMITS.worktrees) {
      worktrees.push(current);
    }
  }

  for (const line of lines(value)) {
    if (line.startsWith("worktree ")) {
      pushCurrent();
      current = { path: line.slice("worktree ".length) };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
      continue;
    }

    if (line.startsWith("branch ")) {
      current.branch = shortBranchName(line.slice("branch ".length));
    }
  }

  pushCurrent();
  return worktrees;
}

export function parseStashes(value?: string): GitStashEntry[] {
  return lines(value)
    .slice(0, GIT_DETAIL_LIMITS.stashes)
    .map((line) => {
      const [ref, hash, date, ...messageParts] = line.split("\t");
      const indexMatch = ref.match(/stash@\{(\d+)\}/);
      const index = indexMatch ? Number(indexMatch[1]) : -1;
      const entry: GitStashEntry = {
        name: ref,
        index: Number.isFinite(index) ? index : -1,
        message: messageParts.join("\t")
      };

      if (date) {
        entry.date = date;
      }

      if (hash) {
        entry.hash = hash;
      }

      return entry;
    })
    .filter((entry) => entry.index >= 0);
}

export function parseDirtyFiles(value?: string): GitDirtyFile[] {
  if (!value) {
    return [];
  }

  const tokens = value.split("\0").filter(Boolean);
  const dirtyFiles: GitDirtyFile[] = [];

  for (let index = 0; index < tokens.length && dirtyFiles.length < GIT_DETAIL_LIMITS.dirtyFiles; index += 1) {
    const token = tokens[index];
    const status = token.slice(0, 2);
    const filePath = token.slice(3);

    if (!status || !filePath) {
      continue;
    }

    const dirtyFile: GitDirtyFile = {
      status,
      path: filePath
    };

    if (/[CR]/.test(status) && tokens[index + 1]) {
      dirtyFile.originalPath = tokens[index + 1];
      index += 1;
    }

    dirtyFiles.push(dirtyFile);
  }

  return dirtyFiles;
}

export function parseGitGraph(value?: string): GitGraphCommit[] {
  return lines(value)
    .slice(0, GIT_DETAIL_LIMITS.graphCommits)
    .flatMap((line) => {
      const hashMatch = line.match(/[0-9a-f]{40}/);
      if (!hashMatch || hashMatch.index === undefined) {
        return [];
      }

      const graph = line.slice(0, hashMatch.index).trimEnd();
      const data = line.slice(hashMatch.index).split("\t");
      const [hash, shortHash, parentsValue, date, author, refsValue, ...subjectParts] = data;
      const subject = subjectParts.join("\t").trim();

      if (!hash || !shortHash || !subject) {
        return [];
      }

      const refs = refsValue
        ? refsValue
            .split(",")
            .map((ref) => ref.trim())
            .filter(Boolean)
        : [];

      return [
        {
          hash,
          shortHash,
          parents: parentsValue ? parentsValue.split(/\s+/).filter(Boolean) : [],
          date: date || undefined,
          author: author || undefined,
          subject,
          refs,
          graph,
          head: refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD -> "))
        }
      ];
    });
}

function parseShortStat(value: string): Pick<BranchCommit, "filesChanged" | "insertions" | "deletions"> {
  const filesMatch = value.match(/(\d+) files? changed/);
  const insertionsMatch = value.match(/(\d+) insertions?\(\+\)/);
  const deletionsMatch = value.match(/(\d+) deletions?\(-\)/);

  return {
    filesChanged: filesMatch ? Number(filesMatch[1]) : undefined,
    insertions: insertionsMatch ? Number(insertionsMatch[1]) : undefined,
    deletions: deletionsMatch ? Number(deletionsMatch[1]) : undefined
  };
}

export function parseBranchCommits(value?: string): BranchCommit[] {
  if (!value) {
    return [];
  }

  return value
    .split("\0")
    .filter((record) => record.trim().length > 0)
    .slice(0, GIT_DETAIL_LIMITS.branchCommits)
    .flatMap((record) => {
      const [header, ...statLines] = record.split(/\r?\n/).filter((line) => line.trim().length > 0);
      const [hash, shortHash, date, author, ...subjectParts] = (header ?? "").split("\t");
      const subject = subjectParts.join("\t").trim();

      if (!hash || !shortHash || !subject) {
        return [];
      }

      const commit: BranchCommit = {
        hash,
        shortHash,
        date: date || undefined,
        author: author || undefined,
        subject
      };

      const statLine = statLines.find((line) => /changed/.test(line));
      return [statLine ? { ...commit, ...parseShortStat(statLine) } : commit];
    });
}

export async function collectBranchCommits(repoPath: string, branch: string): Promise<BranchCommit[] | undefined> {
  if (branch.startsWith("-")) {
    return undefined;
  }

  const verified = await gitOptional(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (!verified) {
    return undefined;
  }

  const log = await gitOptional(repoPath, [
    "log",
    `refs/heads/${branch}`,
    `--max-count=${GIT_DETAIL_LIMITS.branchCommits}`,
    "--date=iso-strict",
    "--shortstat",
    "--format=%x00%H%x09%h%x09%cI%x09%an%x09%s"
  ]);

  return parseBranchCommits(log);
}

function parseBranchMetadata(branches: LocalGitBranch[]): { staleBranchCount: number; orphanBranchCount: number } {
  const threshold = Date.now() - 1000 * 60 * 60 * 24 * 90;
  let staleBranchCount = 0;
  let orphanBranchCount = 0;

  for (const branch of branches) {
    if (!branch.upstream) {
      orphanBranchCount += 1;
    }

    const parsed = branch.lastCommitDate ? Date.parse(branch.lastCommitDate) : undefined;
    if (branch.stale ?? (parsed !== undefined && Number.isFinite(parsed) && parsed < threshold)) {
      staleBranchCount += 1;
    }
  }

  return { staleBranchCount, orphanBranchCount };
}

function uniqueRemoteCount(value?: string): number {
  return new Set(lines(value).map((line) => line.split(/\s+/)[0]).filter(Boolean)).size;
}

export async function collectGitState(repoPath: string): Promise<GitState> {
  const errors: string[] = [];

  const [
    branch,
    detachedHead,
    localBranches,
    remoteBranches,
    worktrees,
    stashes,
    status,
    aheadBehind,
    remotes,
    lastCommit,
    graph
  ] = await Promise.all([
    gitOptional(repoPath, ["symbolic-ref", "--short", "HEAD"]),
    gitOptional(repoPath, ["rev-parse", "--short", "HEAD"]),
    gitOptional(repoPath, [
      "for-each-ref",
      `--count=${GIT_DETAIL_LIMITS.localBranches}`,
      "--sort=refname",
      "--format=%(refname:short)%09%(upstream:short)%09%(committerdate:iso-strict)%09%(upstream:track)",
      "refs/heads"
    ]),
    gitOptional(repoPath, [
      "for-each-ref",
      `--count=${GIT_DETAIL_LIMITS.remoteBranches}`,
      "--sort=refname",
      "--format=%(refname:short)%09%(committerdate:iso-strict)%09%(objectname:short)",
      "refs/remotes"
    ]),
    gitOptional(repoPath, ["worktree", "list", "--porcelain"]),
    gitOptional(repoPath, ["stash", "list", `--max-count=${GIT_DETAIL_LIMITS.stashes}`, "--date=iso-strict", "--format=%gd%x09%H%x09%cd%x09%gs"]),
    gitOptional(repoPath, ["status", "--porcelain=v1", "-z"]),
    gitOptional(repoPath, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
    gitOptional(repoPath, ["remote", "-v"]),
    gitOptional(repoPath, ["log", "-1", "--format=%cI%x09%an%x09%s%x09%h"]),
    gitOptional(repoPath, [
      "log",
      "--graph",
      "--decorate=short",
      "--date=iso-strict",
      "--all",
      `--max-count=${GIT_DETAIL_LIMITS.graphCommits}`,
      "--format=%H%x09%h%x09%P%x09%cI%x09%an%x09%D%x09%s"
    ])
  ]);

  if (!branch && !detachedHead) {
    errors.push("Unable to resolve HEAD.");
  }

  const parsedLocalBranches = parseLocalBranches(localBranches);
  const parsedRemoteBranches = parseRemoteBranches(remoteBranches);
  const parsedWorktrees = parseWorktrees(worktrees);
  const parsedStashes = parseStashes(stashes);
  const dirtyFiles = parseDirtyFiles(status);
  const graphCommits = parseGitGraph(graph);
  const localBranchCount = parsedLocalBranches.length;
  const remoteBranchCount = parsedRemoteBranches.length;
  const statusCounts = countStatus(dirtyFiles);
  const upstream = parseAheadBehind(aheadBehind);
  const metadata = parseBranchMetadata(parsedLocalBranches);

  return {
    isRepo: true,
    currentBranch: branch,
    detachedHead: branch ? undefined : detachedHead,
    localBranches: parsedLocalBranches,
    remoteBranches: parsedRemoteBranches,
    worktrees: parsedWorktrees,
    stashes: parsedStashes,
    dirtyFiles,
    graph: graphCommits,
    localBranchCount,
    remoteBranchCount,
    branchCount: localBranchCount + remoteBranchCount,
    staleBranchCount: metadata.staleBranchCount,
    orphanBranchCount: metadata.orphanBranchCount,
    worktreeCount: parsedWorktrees.length,
    stashCount: parsedStashes.length,
    ...statusCounts,
    ...upstream,
    remoteCount: uniqueRemoteCount(remotes),
    lastCommit: parseLastCommit(lastCommit),
    errors
  };
}
