export type TaskStatus = "inbox" | "backlog" | "next" | "in_progress" | "blocked" | "done";

export type IssueSeverity = "info" | "warning" | "error";

export interface ProjectMetadata {
  name?: string;
  summary?: string;
  status?: string;
  stack: string[];
  current_focus?: string;
  owner?: string;
  created?: string;
  tags: string[];
}

export interface ProjectTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority?: string;
  branch?: string;
  notes?: string;
}

export interface TaskCounts {
  inbox: number;
  backlog: number;
  next: number;
  in_progress: number;
  blocked: number;
  done: number;
}

export interface ProjectDocument {
  key: string;
  label: string;
  relativePath: string;
  exists: boolean;
  empty: boolean;
  bytes: number;
  updatedAt?: string;
}

export interface LastCommit {
  hash?: string;
  subject?: string;
  author?: string;
  date?: string;
}

export interface LocalGitBranch {
  name: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  lastCommitDate?: string;
  stale?: boolean;
}

export interface RemoteGitBranch {
  name: string;
  lastCommitDate?: string;
  head?: string;
}

export interface GitWorktree {
  path: string;
  branch?: string;
  head?: string;
}

export interface GitStashEntry {
  name: string;
  index: number;
  message: string;
  date?: string;
  hash?: string;
}

export interface GitDirtyFile {
  status: string;
  path: string;
  originalPath?: string;
}

export interface GitGraphCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  date?: string;
  author?: string;
  subject: string;
  refs: string[];
  graph: string;
  head?: boolean;
}

export interface GitState {
  isRepo: boolean;
  currentBranch?: string;
  detachedHead?: string;
  localBranches: LocalGitBranch[];
  remoteBranches: RemoteGitBranch[];
  worktrees: GitWorktree[];
  stashes: GitStashEntry[];
  dirtyFiles: GitDirtyFile[];
  graph: GitGraphCommit[];
  localBranchCount: number;
  remoteBranchCount: number;
  branchCount: number;
  staleBranchCount: number;
  orphanBranchCount: number;
  worktreeCount: number;
  stashCount: number;
  dirty: boolean;
  uncommittedCount: number;
  untrackedCount: number;
  ahead?: number;
  behind?: number;
  hasUpstream: boolean;
  remoteCount: number;
  lastCommit: LastCommit;
  errors: string[];
}

export interface BranchIntent {
  name: string;
  role?: string;
  status?: string;
  parent?: string;
  purpose?: string;
  worktree?: string;
  notes: string[];
}

export interface BranchCommit {
  hash: string;
  shortHash: string;
  date?: string;
  author?: string;
  subject: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
}

export interface BranchCommitsResponse {
  projectPath: string;
  branch: string;
  commits: BranchCommit[];
}

export interface ComplianceIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  file?: string;
  optional?: boolean;
}

export interface DevCenterStandards {
  branch_naming: Record<string, string>;
  required_files: string[];
  task_statuses: TaskStatus[];
  preferred_license?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  status: string;
  lastModified?: string;
  /** Newest dirty-file mtime or local branch tip — "when did I last touch this". */
  lastChange?: string;
  metadata: ProjectMetadata;
  metadataExists: boolean;
  tasks: ProjectTask[];
  taskCounts: TaskCounts;
  branchIntents: BranchIntent[];
  branchIntentsExist: boolean;
  documents: ProjectDocument[];
  contextUpdatedAt?: string;
  lastAiUpdate?: string;
  git: GitState;
  compliance: ComplianceIssue[];
  attention: string[];
}

export interface ProjectsResponse {
  scanRoot: string;
  generatedAt: string;
  warnings: string[];
  standards: DevCenterStandards;
  projects: ProjectSummary[];
}

export interface TaskChanges {
  title?: string;
  status?: TaskStatus;
  priority?: string;
  branch?: string;
  notes?: string;
}

export interface TaskCreateResponse {
  projectPath: string;
  taskId: string;
  tasks: ProjectTask[];
}

export interface TaskUpdateResponse {
  projectPath: string;
  taskId: string;
  tasks: ProjectTask[];
}

export interface DocumentResponse {
  projectPath: string;
  relativePath: string;
  content: string;
}
