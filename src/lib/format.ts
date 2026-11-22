import type {
  BranchCommit,
  BranchIntent,
  ComplianceIssue,
  GitDirtyFile,
  LocalGitBranch,
  ProjectDocument,
  ProjectSummary,
  ProjectTask,
  TaskCounts,
  TaskStatus
} from "../types";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";
export type TagHue = "blue" | "teal" | "violet" | "amber" | "rose";

export const taskStatusLabels: Record<TaskStatus, string> = {
  inbox: "Inbox",
  backlog: "Backlog",
  next: "Next",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done"
};

export const taskStatusOrder: TaskStatus[] = ["inbox", "backlog", "next", "in_progress", "blocked", "done"];

export function countTaskStatuses(tasks: ProjectTask[]): TaskCounts {
  return tasks.reduce<TaskCounts>(
    (counts, task) => {
      counts[task.status] += 1;
      return counts;
    },
    { inbox: 0, backlog: 0, next: 0, in_progress: 0, blocked: 0, done: 0 }
  );
}

export function priorityTone(priority?: string): BadgeTone {
  switch ((priority ?? "").toLowerCase()) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "info";
    default:
      return "neutral";
  }
}

/** Sort rank: urgent priorities first, unset last. */
export function priorityRank(priority?: string): number {
  switch ((priority ?? "").toLowerCase()) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    default:
      return 4;
  }
}

export type DashboardFilterKey =
  | "dirty"
  | "clean"
  | "missingReadme"
  | "noRemote"
  | "unpushed"
  | "hasStashes"
  | "hasWorktrees"
  | "staleBranches"
  | "notRepo"
  | "optionalMetadataIssues";

export const dashboardFilterOptions: Array<{ key: DashboardFilterKey; label: string }> = [
  { key: "dirty", label: "Dirty" },
  { key: "clean", label: "Clean" },
  { key: "missingReadme", label: "Missing README" },
  { key: "noRemote", label: "No Remote" },
  { key: "unpushed", label: "Unpushed" },
  { key: "hasStashes", label: "Has Stashes" },
  { key: "hasWorktrees", label: "Has Worktrees" },
  { key: "staleBranches", label: "Stale Branches" },
  { key: "notRepo", label: "Not a Repo" },
  { key: "optionalMetadataIssues", label: "Optional Metadata Issues" }
];

export function formatDate(value?: string): string {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

export function formatRelative(value?: string): string {
  if (!value) {
    return "Unknown";
  }

  const diffMs = Date.now() - new Date(value).getTime();
  const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "Yesterday";
  }

  return `${days}d ago`;
}

export function openTaskCount(project: ProjectSummary): number {
  return project.taskCounts.inbox + project.taskCounts.backlog + project.taskCounts.next + project.taskCounts.in_progress + project.taskCounts.blocked;
}

export type DirtyFileGroups = Record<"staged" | "unstaged" | "untracked" | "deleted", GitDirtyFile[]>;

export function groupDirtyFiles(files?: GitDirtyFile[]): DirtyFileGroups {
  const groups: DirtyFileGroups = {
    staged: [],
    unstaged: [],
    untracked: [],
    deleted: []
  };

  for (const file of files ?? []) {
    const status = file.status.padEnd(2, " ");
    if (status.includes("??")) {
      groups.untracked.push(file);
      continue;
    }

    if (status.includes("D")) {
      groups.deleted.push(file);
    }

    if (status[0] !== " " && status[0] !== "D") {
      groups.staged.push(file);
    }

    if (status[1] !== " " && status[1] !== "D") {
      groups.unstaged.push(file);
    }
  }

  return groups;
}

export interface BranchMapRow {
  name: string;
  existsLocally: boolean;
  current: boolean;
  intent?: BranchIntent;
  branch?: LocalGitBranch;
  worktreePath?: string;
}

function branchRolePriority(row: BranchMapRow): number {
  if (row.current) {
    return 0;
  }

  if (!row.existsLocally) {
    return 9;
  }

  switch (row.intent?.role) {
    case "deployed":
      return 1;
    case "rewrite":
      return 2;
    case "feature":
      return 3;
    case "agent-worktree":
      return 5;
    case "legacy":
      return 6;
    default:
      return 4;
  }
}

export function buildBranchMapRows(project: ProjectSummary): BranchMapRow[] {
  const intentsByName = new Map(project.branchIntents.map((intent) => [intent.name, intent]));
  const worktreesByBranch = new Map(
    (project.git.worktrees ?? [])
      .filter((worktree) => worktree.branch)
      .map((worktree) => [worktree.branch as string, worktree.path])
  );

  const rows: BranchMapRow[] = (project.git.localBranches ?? []).map((branch) => ({
    name: branch.name,
    existsLocally: true,
    current: branch.name === project.git.currentBranch,
    intent: intentsByName.get(branch.name),
    branch,
    worktreePath: worktreesByBranch.get(branch.name)
  }));

  const localNames = new Set(rows.map((row) => row.name));
  for (const intent of project.branchIntents) {
    if (!localNames.has(intent.name)) {
      rows.push({ name: intent.name, existsLocally: false, current: false, intent });
    }
  }

  return rows.sort((left, right) => branchRolePriority(left) - branchRolePriority(right) || left.name.localeCompare(right.name));
}

/** Branch roles are categorical labels with one stable meaning per hue. */
export const branchRoleHues: Record<string, TagHue> = {
  deployed: "blue",
  rewrite: "violet",
  feature: "teal",
  "agent-worktree": "amber",
  legacy: "rose"
};

export function branchIsStale(branch: LocalGitBranch): boolean {
  if (typeof branch.stale === "boolean") {
    return branch.stale;
  }

  if (!branch.lastCommitDate) {
    return false;
  }

  return Date.now() - new Date(branch.lastCommitDate).getTime() > 1000 * 60 * 60 * 24 * 90;
}

export function formatAheadBehind(branch: LocalGitBranch): string {
  const ahead = branch.ahead ?? 0;
  const behind = branch.behind ?? 0;

  if (!branch.upstream) {
    return "No upstream";
  }

  if (ahead === 0 && behind === 0) {
    return "Even";
  }

  return `${ahead} ahead / ${behind} behind`;
}

export function formatCommitStats(commit: BranchCommit): string | undefined {
  if (commit.filesChanged === undefined) {
    return undefined;
  }

  const parts = [`${commit.filesChanged} file${commit.filesChanged === 1 ? "" : "s"}`];
  if (commit.insertions) {
    parts.push(`+${commit.insertions}`);
  }
  if (commit.deletions) {
    parts.push(`−${commit.deletions}`);
  }

  return parts.join(" ");
}

export function visibleComplianceIssues(project: ProjectSummary, showOptionalMetadataIssues: boolean): ComplianceIssue[] {
  return showOptionalMetadataIssues ? project.compliance : project.compliance.filter((issue) => !issue.optional);
}

export function hiddenOptionalIssueCount(project: ProjectSummary): number {
  return project.compliance.filter((issue) => issue.optional).length;
}

export function complianceIssueCount(project: ProjectSummary, showOptionalMetadataIssues: boolean): number {
  return visibleComplianceIssues(project, showOptionalMetadataIssues).length;
}

export function readmeHasIssue(project: ProjectSummary): boolean {
  const readme = project.documents.find((doc) => doc.key === "readme");
  return !readme?.exists || readme.empty;
}

export function projectMatchesDashboardFilter(project: ProjectSummary, filter: DashboardFilterKey): boolean {
  switch (filter) {
    case "dirty":
      return project.git.isRepo && project.git.dirty;
    case "clean":
      return project.git.isRepo && !project.git.dirty;
    case "missingReadme":
      return readmeHasIssue(project);
    case "noRemote":
      return project.git.isRepo && project.git.remoteCount === 0;
    case "unpushed":
      return (project.git.ahead ?? 0) > 0;
    case "hasStashes":
      return project.git.stashCount > 0;
    case "hasWorktrees":
      return project.git.worktreeCount > 1;
    case "staleBranches":
      return project.git.staleBranchCount > 0;
    case "notRepo":
      return !project.git.isRepo;
    case "optionalMetadataIssues":
      return hiddenOptionalIssueCount(project) > 0;
  }
}

export function dashboardSignals(project: ProjectSummary): string[] {
  const signals: string[] = [];

  if (project.git.isRepo && project.git.remoteCount === 0) {
    signals.push("no remote");
  }

  if ((project.git.ahead ?? 0) > 0) {
    signals.push(`ahead ${project.git.ahead}`);
  }

  if ((project.git.behind ?? 0) > 0) {
    signals.push(`behind ${project.git.behind}`);
  }

  if (project.git.stashCount > 0) {
    signals.push(`stash ${project.git.stashCount}`);
  }

  if (project.git.worktreeCount > 1) {
    signals.push(`worktrees ${project.git.worktreeCount}`);
  }

  if (project.git.staleBranchCount > 0) {
    signals.push(`stale ${project.git.staleBranchCount}`);
  }

  return signals;
}

export function rootFolder(project: ProjectSummary): string {
  return project.relativePath.split("/")[0] || ".";
}

export function formatProjectStatus(status: string): string {
  if (status === "not_repo") {
    return "Not a Repo";
  }

  return status
    .split(/[_-]+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function projectStatusTone(status: string): BadgeTone {
  switch (status.toLowerCase()) {
    case "active":
      return "success";
    case "paused":
    case "on-hold":
      return "warning";
    case "archived":
    case "abandoned":
      return "neutral";
    default:
      return "neutral";
  }
}

export function repoStateTone(project: ProjectSummary): { tone: BadgeTone; label: string } {
  if (!project.git.isRepo) {
    return { tone: "neutral", label: "Not a Repo" };
  }

  return project.git.dirty ? { tone: "warning", label: "Dirty" } : { tone: "success", label: "Clean" };
}

export function severityTone(issue: ComplianceIssue): BadgeTone {
  if (issue.optional) {
    return "neutral";
  }

  switch (issue.severity) {
    case "error":
      return "danger";
    case "warning":
      return "warning";
    case "info":
      return "info";
  }
}

export function documentState(document?: ProjectDocument): { label: string; tone: BadgeTone } {
  if (!document?.exists) {
    return { label: "Missing", tone: "danger" };
  }

  if (document.empty) {
    return { label: "Empty", tone: "warning" };
  }

  return { label: "Found", tone: "success" };
}
