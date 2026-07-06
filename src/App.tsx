import {
  AlertTriangle,
  ArrowLeft,
  ArrowDownUp,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  ListFilter,
  FolderGit2,
  FolderTree,
  GitBranch,
  LayoutDashboard,
  ListTodo,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchCommit,
  BranchCommitsResponse,
  BranchIntent,
  ComplianceIssue,
  DocumentResponse,
  GitDirtyFile,
  GitGraphCommit,
  GitStashEntry,
  GitWorktree,
  LocalGitBranch,
  ProjectDocument,
  ProjectSummary,
  ProjectsResponse,
  TaskStatus
} from "./types";

type ViewKey = "dashboard" | "repository" | "tasks" | "docs" | "compliance" | "standards";
type DashboardFilterKey =
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
type DashboardSortKey =
  | "name"
  | "lastCommitDate"
  | "dirty"
  | "ahead"
  | "behind"
  | "stashCount"
  | "branchCount"
  | "complianceIssueCount";
type SortDirection = "asc" | "desc";
type GitDetailsTab = "graph" | "dirty" | "branches" | "worktrees" | "stashes";

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "repository", label: "Repository", icon: FolderGit2 },
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "docs", label: "Docs", icon: FileText },
  { key: "compliance", label: "Compliance", icon: ShieldCheck },
  { key: "standards", label: "Standards", icon: Settings2 }
];

const taskStatusLabels: Record<TaskStatus, string> = {
  backlog: "Backlog",
  next: "Next",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done"
};

const dashboardFilterOptions: Array<{ key: DashboardFilterKey; label: string }> = [
  { key: "dirty", label: "Dirty" },
  { key: "clean", label: "Clean" },
  { key: "missingReadme", label: "Missing README" },
  { key: "noRemote", label: "No remote" },
  { key: "unpushed", label: "Unpushed" },
  { key: "hasStashes", label: "Stashes" },
  { key: "hasWorktrees", label: "Worktrees" },
  { key: "staleBranches", label: "Stale branches" },
  { key: "notRepo", label: "Not repos" },
  { key: "optionalMetadataIssues", label: "Optional metadata" }
];

const dashboardSortOptions: Array<{ key: DashboardSortKey; label: string }> = [
  { key: "name", label: "Repo name" },
  { key: "lastCommitDate", label: "Last commit date" },
  { key: "dirty", label: "Dirty status" },
  { key: "ahead", label: "Ahead count" },
  { key: "behind", label: "Behind count" },
  { key: "stashCount", label: "Stash count" },
  { key: "branchCount", label: "Branch count" },
  { key: "complianceIssueCount", label: "Compliance issues" }
];

const gitDetailsTabs: Array<{ key: GitDetailsTab; label: string }> = [
  { key: "graph", label: "Graph" },
  { key: "dirty", label: "Dirty Changes" },
  { key: "branches", label: "Branches" },
  { key: "worktrees", label: "Worktrees" },
  { key: "stashes", label: "Stashes" }
];

function formatDate(value?: string): string {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function formatRelative(value?: string): string {
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

function gitDetailsCount(project: ProjectSummary, tab: GitDetailsTab): number {
  switch (tab) {
    case "graph":
      return project.git.graph?.length ?? 0;
    case "dirty":
      return project.git.dirtyFiles?.length ?? project.git.uncommittedCount + project.git.untrackedCount;
    case "branches":
      return project.git.localBranches?.length ?? project.git.localBranchCount;
    case "worktrees":
      return project.git.worktrees?.length ?? project.git.worktreeCount;
    case "stashes":
      return project.git.stashes?.length ?? project.git.stashCount;
  }
}

function openTaskCount(project: ProjectSummary): number {
  return project.taskCounts.backlog + project.taskCounts.next + project.taskCounts.in_progress + project.taskCounts.blocked;
}

function groupDirtyFiles(files?: GitDirtyFile[]): Record<"staged" | "unstaged" | "untracked" | "deleted", GitDirtyFile[]> {
  const groups: Record<"staged" | "unstaged" | "untracked" | "deleted", GitDirtyFile[]> = {
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

interface BranchMapRow {
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

function buildBranchMapRows(project: ProjectSummary): BranchMapRow[] {
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

function formatCommitStats(commit: BranchCommit): string | undefined {
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

function branchIsStale(branch: LocalGitBranch): boolean {
  if (typeof branch.stale === "boolean") {
    return branch.stale;
  }

  if (!branch.lastCommitDate) {
    return false;
  }

  return Date.now() - new Date(branch.lastCommitDate).getTime() > 1000 * 60 * 60 * 24 * 90;
}

function formatAheadBehind(branch: LocalGitBranch): string {
  const ahead = branch.ahead ?? 0;
  const behind = branch.behind ?? 0;

  if (!branch.upstream) {
    return "-";
  }

  if (ahead === 0 && behind === 0) {
    return "Even";
  }

  return `${ahead} ahead / ${behind} behind`;
}

function statusClass(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function refTone(ref: string): string {
  if (ref === "HEAD" || ref.startsWith("HEAD -> ")) {
    return "head";
  }

  if (ref.startsWith("tag: ")) {
    return "tag";
  }

  if (ref.includes("/")) {
    return "remote";
  }

  return "local";
}

function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`status-pill status-${statusClass(tone)}`}>{children}</span>;
}

function Dropdown({
  label,
  icon,
  badge,
  align,
  children
}: {
  label: string;
  icon?: React.ReactNode;
  badge?: number;
  align?: "right";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        className={open ? "dropdown-trigger open" : "dropdown-trigger"}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {icon}
        <span>{label}</span>
        {badge ? <span className="dropdown-badge">{badge}</span> : null}
        <ChevronDown size={13} className="dropdown-caret" aria-hidden="true" />
      </button>
      {open ? (
        <div className={align === "right" ? "dropdown-menu align-right" : "dropdown-menu"} role="menu">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function DropdownCheckItem({
  checked,
  onToggle,
  children
}: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-checked={checked}
      className={checked ? "dropdown-item checked" : "dropdown-item"}
      onClick={onToggle}
      role="menuitemcheckbox"
      type="button"
    >
      <span className="dropdown-check" aria-hidden="true">
        {checked ? <Check size={12} aria-hidden="true" /> : null}
      </span>
      <span className="dropdown-item-label">{children}</span>
    </button>
  );
}

function DropdownDivider({ label }: { label?: string }) {
  return <div className="dropdown-divider">{label ? <span>{label}</span> : null}</div>;
}

function visibleComplianceIssues(project: ProjectSummary, showOptionalMetadataIssues: boolean): ComplianceIssue[] {
  return showOptionalMetadataIssues ? project.compliance : project.compliance.filter((issue) => !issue.optional);
}

function hiddenOptionalIssueCount(project: ProjectSummary): number {
  return project.compliance.filter((issue) => issue.optional).length;
}

function readmeHasIssue(project: ProjectSummary): boolean {
  const readme = project.documents.find((doc) => doc.key === "readme");
  return !readme?.exists || readme.empty;
}

function complianceIssueCount(project: ProjectSummary, showOptionalMetadataIssues: boolean): number {
  return visibleComplianceIssues(project, showOptionalMetadataIssues).length;
}

function projectMatchesDashboardFilter(project: ProjectSummary, filter: DashboardFilterKey): boolean {
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

function dashboardSignals(project: ProjectSummary): string[] {
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
    signals.push(`wt ${project.git.worktreeCount}`);
  }

  return signals;
}

function rootFolder(project: ProjectSummary): string {
  return project.relativePath.split("/")[0] || ".";
}

function sortProjects(
  projects: ProjectSummary[],
  sortKey: DashboardSortKey,
  sortDirection: SortDirection,
  showOptionalMetadataIssues: boolean
): ProjectSummary[] {
  const direction = sortDirection === "asc" ? 1 : -1;

  return [...projects].sort((left, right) => {
    if (sortKey === "name") {
      return direction * left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    }

    if (sortKey === "lastCommitDate") {
      const leftDate = left.git.lastCommit.date ? Date.parse(left.git.lastCommit.date) : undefined;
      const rightDate = right.git.lastCommit.date ? Date.parse(right.git.lastCommit.date) : undefined;

      if (!Number.isFinite(leftDate) && !Number.isFinite(rightDate)) {
        return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      }

      if (!Number.isFinite(leftDate)) {
        return 1;
      }

      if (!Number.isFinite(rightDate)) {
        return -1;
      }

      const dateCompare = (leftDate! - rightDate!) * direction;
      return dateCompare || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    }

    const values: Record<Exclude<DashboardSortKey, "name" | "lastCommitDate">, [number, number]> = {
      dirty: [left.git.dirty ? 1 : 0, right.git.dirty ? 1 : 0],
      ahead: [left.git.ahead ?? 0, right.git.ahead ?? 0],
      behind: [left.git.behind ?? 0, right.git.behind ?? 0],
      stashCount: [left.git.stashCount, right.git.stashCount],
      branchCount: [left.git.branchCount, right.git.branchCount],
      complianceIssueCount: [
        complianceIssueCount(left, showOptionalMetadataIssues),
        complianceIssueCount(right, showOptionalMetadataIssues)
      ]
    };
    const [leftValue, rightValue] = values[sortKey];

    return (leftValue - rightValue) * direction || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

function documentState(document?: ProjectDocument, optional = false): { label: string; tone: string; title: string } {
  if (!document?.exists) {
    return {
      label: "Missing",
      tone: optional ? "optional" : "missing",
      title: optional ? "Missing optional metadata document" : "Missing required document"
    };
  }

  if (document.empty) {
    return {
      label: "Empty",
      tone: optional ? "optional" : "missing",
      title: optional ? "Optional metadata document exists but is empty" : "Required document exists but is empty"
    };
  }

  return {
    label: "Found",
    tone: "ok",
    title: "Document found"
  };
}

function DocStatusBadge({
  document,
  label,
  optional = false
}: {
  document?: ProjectDocument;
  label: string;
  optional?: boolean;
}) {
  const state = documentState(document, optional);
  const fileLabel = document?.relativePath ?? `${label}.md`;

  return (
    <span className={`doc-status doc-status-${state.tone}`} title={`${fileLabel}: ${state.title}`} aria-label={`${label} ${state.label}`}>
      <span className={`dot ${state.tone}`} aria-hidden="true" />
      <span>{label}</span>
      <strong>{state.label}</strong>
    </span>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <FolderGit2 size={28} aria-hidden="true" />
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function Sidebar({ currentView, onChange }: { currentView: ViewKey; onChange: (view: ViewKey) => void }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">D</div>
        <div>
          <strong>DevCenter</strong>
          <span>Local command center</span>
        </div>
      </div>

      <nav aria-label="Primary">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-label={item.label}
              className={currentView === item.key ? "nav-item active" : "nav-item"}
              key={item.key}
              onClick={() => onChange(item.key)}
              title={item.label}
              type="button"
            >
              <Icon size={17} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function TopBar({
  scanRoot,
  generatedAt,
  search,
  onSearch,
  onRefresh,
  loading
}: {
  scanRoot?: string;
  generatedAt?: string;
  search: string;
  onSearch: (value: string) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <header className="topbar">
      <div className="scan-root">
        <span>scan root</span>
        <code>{scanRoot ?? "Loading…"}</code>
      </div>

      <div className="topbar-actions">
        <label className="search-control">
          <Search size={15} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search repos, branches, paths…"
          />
        </label>
        <span className="updated-at">updated {formatRelative(generatedAt)}</span>
        <button className="icon-button" onClick={onRefresh} type="button" aria-label="Rescan repositories">
          <RefreshCw size={15} className={loading ? "spin" : undefined} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={tone ? `metric metric-${tone}` : "metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DashboardMetrics({
  projects,
  showOptionalMetadataIssues
}: {
  projects: ProjectSummary[];
  showOptionalMetadataIssues: boolean;
}) {
  const dirty = projects.filter((project) => project.git.dirty).length;
  const docsMissing = projects.filter((project) => project.attention.includes("missing docs")).length;
  const compliance = projects.filter((project) => visibleComplianceIssues(project, showOptionalMetadataIssues).length > 0).length;
  const blocked = projects.reduce((count, project) => count + project.taskCounts.blocked, 0);

  return (
    <section className="metrics" aria-label="Project summary">
      <Metric label="Projects" value={projects.length} />
      <Metric label="Dirty" value={dirty} tone={dirty ? "warning" : undefined} />
      <Metric label="Docs gaps" value={docsMissing} tone={docsMissing ? "warning" : undefined} />
      <Metric label="Compliance" value={compliance} tone={compliance ? "warning" : undefined} />
      <Metric label="Blocked tasks" value={blocked} tone={blocked ? "danger" : undefined} />
    </section>
  );
}

function DashboardControls({
  activeFilters,
  onFilterToggle,
  onClearFilters,
  sortKey,
  onSortKeyChange,
  sortDirection,
  onSortDirectionChange,
  visibleCount,
  totalCount,
  rootFolders,
  hiddenRootFolders,
  onRootFolderToggle,
  showOptionalMetadataIssues,
  onShowOptionalMetadataIssuesChange
}: {
  activeFilters: DashboardFilterKey[];
  onFilterToggle: (filter: DashboardFilterKey) => void;
  onClearFilters: () => void;
  sortKey: DashboardSortKey;
  onSortKeyChange: (key: DashboardSortKey) => void;
  sortDirection: SortDirection;
  onSortDirectionChange: (direction: SortDirection) => void;
  visibleCount: number;
  totalCount: number;
  rootFolders: string[];
  hiddenRootFolders: string[];
  onRootFolderToggle: (folder: string) => void;
  showOptionalMetadataIssues: boolean;
  onShowOptionalMetadataIssuesChange: (value: boolean) => void;
}) {
  const activeFilterSet = new Set(activeFilters);
  const hiddenRootFolderSet = new Set(hiddenRootFolders);
  const filterLabels = new Map(dashboardFilterOptions.map((option) => [option.key, option.label]));
  const sortLabel = dashboardSortOptions.find((option) => option.key === sortKey)?.label ?? "Sort";

  return (
    <section className="dashboard-toolbar" aria-label="Dashboard filters and sorting">
      <Dropdown label="Filter" icon={<ListFilter size={14} aria-hidden="true" />} badge={activeFilters.length || undefined}>
        {dashboardFilterOptions.map((option) => (
          <DropdownCheckItem
            checked={activeFilterSet.has(option.key)}
            key={option.key}
            onToggle={() => onFilterToggle(option.key)}
          >
            {option.label}
          </DropdownCheckItem>
        ))}
        <DropdownDivider label="Display" />
        <DropdownCheckItem
          checked={showOptionalMetadataIssues}
          onToggle={() => onShowOptionalMetadataIssuesChange(!showOptionalMetadataIssues)}
        >
          Show optional metadata checks
        </DropdownCheckItem>
      </Dropdown>

      {rootFolders.length > 1 ? (
        <Dropdown
          label="Folders"
          icon={<FolderTree size={14} aria-hidden="true" />}
          badge={hiddenRootFolders.length || undefined}
        >
          <DropdownDivider label="Uncheck to hide" />
          {rootFolders.map((folder) => (
            <DropdownCheckItem
              checked={!hiddenRootFolderSet.has(folder)}
              key={folder}
              onToggle={() => onRootFolderToggle(folder)}
            >
              {folder}
            </DropdownCheckItem>
          ))}
        </Dropdown>
      ) : null}

      <Dropdown label={sortLabel} icon={<ArrowDownUp size={14} aria-hidden="true" />}>
        {dashboardSortOptions.map((option) => (
          <DropdownCheckItem checked={sortKey === option.key} key={option.key} onToggle={() => onSortKeyChange(option.key)}>
            {option.label}
          </DropdownCheckItem>
        ))}
      </Dropdown>

      <button
        className="sort-direction"
        onClick={() => onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc")}
        type="button"
        aria-label={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`}
        title={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`}
      >
        {sortDirection === "asc" ? "↑ asc" : "↓ desc"}
      </button>

      {activeFilters.length > 0 ? (
        <div className="active-filter-chips" aria-label="Active filters">
          {activeFilters.map((filter) => (
            <button
              className="active-filter-chip"
              key={filter}
              onClick={() => onFilterToggle(filter)}
              type="button"
              title={`Remove ${filterLabels.get(filter)} filter`}
            >
              {filterLabels.get(filter)}
              <X size={11} aria-hidden="true" />
            </button>
          ))}
          <button className="clear-filters" onClick={onClearFilters} type="button">
            Clear all
          </button>
        </div>
      ) : null}

      <span className="result-count">
        {visibleCount} <em>of</em> {totalCount}
      </span>
    </section>
  );
}

function RepoTable({
  projects,
  selectedId,
  onSelect,
  onOpenProject,
  showOptionalMetadataIssues
}: {
  projects: ProjectSummary[];
  selectedId?: string;
  onSelect: (project: ProjectSummary) => void;
  onOpenProject: (project: ProjectSummary) => void;
  showOptionalMetadataIssues: boolean;
}) {
  if (projects.length === 0) {
    return <EmptyState title="No repositories match" detail="Adjust search, filters, or scan settings to show repositories." />;
  }

  return (
    <div className="table-shell">
      <table className="repo-table">
        <thead>
          <tr>
            <th>Repository</th>
            <th>Branch</th>
            <th>State</th>
            <th>Signals</th>
            <th>Docs</th>
            <th>Branches</th>
            <th>Issues</th>
            <th>Tasks</th>
            <th>Last Commit</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const readme = project.documents.find((doc) => doc.key === "readme");
            const agents = project.documents.find((doc) => doc.key === "agents");
            const taskOpen = openTaskCount(project);
            const signals = dashboardSignals(project);

            return (
              <tr
                className={selectedId === project.id ? "selected" : undefined}
                key={project.id}
                onClick={() => onSelect(project)}
              >
                <td>
                  <div className="repo-cell">
                    <button className="repo-name" onClick={() => onSelect(project)} type="button" title={project.metadata.summary ?? project.name}>
                      <span>{project.name}</span>
                      <small>{project.relativePath}</small>
                    </button>
                    <button
                      className="repo-open-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenProject(project);
                      }}
                      type="button"
                      aria-label={`Open ${project.name} repository page`}
                      title="Open repository page"
                    >
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                </td>
                <td>
                  {project.git.isRepo ? (
                    <span className="branch-cell">
                      <GitBranch size={14} aria-hidden="true" />
                      {project.git.currentBranch ?? project.git.detachedHead ?? "unknown"}
                    </span>
                  ) : (
                    <span className="muted-dash">—</span>
                  )}
                </td>
                <td>
                  {!project.git.isRepo ? (
                    <StatusPill tone="not-repo">Not repo</StatusPill>
                  ) : project.git.dirty ? (
                    <StatusPill tone="warning">Dirty</StatusPill>
                  ) : (
                    <StatusPill tone="ok">Clean</StatusPill>
                  )}
                </td>
                <td>
                  {signals.length > 0 ? (
                    <span className="signal-list" aria-label="Repository signals">
                      {signals.map((signal) => (
                        <span key={signal}>{signal}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="muted-dash">-</span>
                  )}
                </td>
                <td>
                  <span className="doc-status-group" aria-label="Documentation status">
                    <DocStatusBadge document={readme} label="README" />
                    <DocStatusBadge document={agents} label="AGENTS" optional />
                  </span>
                </td>
                <td>
                  <span className="count-with-context">
                    {project.git.branchCount}
                    {project.git.staleBranchCount > 0 ? <small>{project.git.staleBranchCount} stale</small> : null}
                  </span>
                </td>
                <td>{complianceIssueCount(project, showOptionalMetadataIssues)}</td>
                <td>{taskOpen}</td>
                <td className="commit-cell">{formatRelative(project.git.lastCommit.date)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DirtyChangesList({ files, dirty }: { files?: GitDirtyFile[]; dirty: boolean }) {
  if (!files) {
    return <p className="subtle-line">{dirty ? "Dirty change details are not available in this API response." : "No dirty changes."}</p>;
  }

  if (files.length === 0) {
    return <p className="clean-line">No dirty changes.</p>;
  }

  return (
    <div className="git-detail-list" role="list">
      {files.map((file) => (
        <div className="git-detail-row dirty-row" key={`${file.status}-${file.originalPath ?? ""}-${file.path}`} role="listitem">
          <code className="git-status-code">{file.status}</code>
          <span className="git-path" title={file.path}>
            {file.path}
            {file.originalPath ? <small>from {file.originalPath}</small> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function BranchesList({
  branches,
  currentBranch,
  localBranchCount
}: {
  branches?: LocalGitBranch[];
  currentBranch?: string;
  localBranchCount: number;
}) {
  if (!branches) {
    return <p className="subtle-line">{localBranchCount} local branches. Branch details are not available in this API response.</p>;
  }

  if (branches.length === 0) {
    return <p className="subtle-line">No local branches found.</p>;
  }

  return (
    <div className="git-detail-list branches-list" role="list">
      <div className="git-detail-heading" aria-hidden="true">
        <span>Local branch</span>
        <span>Upstream</span>
        <span>Ahead / behind</span>
        <span>Stale</span>
      </div>
      {branches.map((branch) => (
        <div className="git-detail-row branch-row" key={branch.name} role="listitem">
          <span className="git-branch-name" title={branch.name}>
            {branch.name}
            {branch.name === currentBranch ? <small>current</small> : null}
          </span>
          <span className="git-muted" title={branch.upstream ?? "No upstream"}>
            {branch.upstream ?? "No upstream"}
          </span>
          <span>{formatAheadBehind(branch)}</span>
          <span>{branchIsStale(branch) ? <StatusPill tone="warning">Stale</StatusPill> : <StatusPill tone="ok">Fresh</StatusPill>}</span>
        </div>
      ))}
    </div>
  );
}

function WorktreesList({ worktrees, worktreeCount }: { worktrees?: GitWorktree[]; worktreeCount: number }) {
  if (!worktrees) {
    return <p className="subtle-line">{worktreeCount} worktrees. Worktree details are not available in this API response.</p>;
  }

  if (worktrees.length === 0) {
    return <p className="subtle-line">No worktrees found.</p>;
  }

  return (
    <div className="git-detail-list" role="list">
      {worktrees.map((worktree) => (
        <div className="git-detail-row worktree-row" key={`${worktree.path}-${worktree.branch ?? worktree.head ?? ""}`} role="listitem">
          <span className="git-path" title={worktree.path}>
            {worktree.path}
          </span>
          <span className="git-muted">{worktree.branch ?? worktree.head ?? "unknown"}</span>
        </div>
      ))}
    </div>
  );
}

function StashesList({ stashes, stashCount }: { stashes?: GitStashEntry[]; stashCount: number }) {
  if (!stashes) {
    return <p className="subtle-line">{stashCount} stashes. Stash details are not available in this API response.</p>;
  }

  if (stashes.length === 0) {
    return <p className="clean-line">No stashes.</p>;
  }

  return (
    <div className="git-detail-list" role="list">
      {stashes.map((stash) => (
        <div className="git-detail-row stash-row" key={`${stash.name}-${stash.hash ?? stash.index}`} role="listitem">
          <code>{stash.name}</code>
          <span className="git-path" title={stash.message}>
            {stash.message}
          </span>
          <span className="git-muted">{formatDate(stash.date)}</span>
        </div>
      ))}
    </div>
  );
}

function GitGraphGlyphs({ graph }: { graph: string }) {
  const glyphs = graph.length > 0 ? [...graph] : ["*"];

  return (
    <span className="git-graph-glyphs" aria-hidden="true">
      {glyphs.map((glyph, index) => (
        <span
          className={glyph.trim() ? `git-graph-glyph graph-color-${index % 7}` : "git-graph-space"}
          key={`${glyph}-${index}`}
        >
          {glyph === " " ? "\u00a0" : glyph}
        </span>
      ))}
    </span>
  );
}

function GitGraphList({ commits }: { commits?: GitGraphCommit[] }) {
  if (!commits) {
    return <p className="subtle-line">Graph details are not available in this API response.</p>;
  }

  if (commits.length === 0) {
    return <p className="subtle-line">No graph commits found.</p>;
  }

  return (
    <div className="git-graph-list" role="list">
      {commits.map((commit) => (
        <div className={commit.head ? "git-graph-row current" : "git-graph-row"} key={commit.hash} role="listitem">
          <GitGraphGlyphs graph={commit.graph} />
          <div className="git-graph-commit">
            <div className="git-graph-meta">
              {commit.refs.map((ref) => (
                <span className={`git-ref git-ref-${refTone(ref)}`} key={`${commit.hash}-${ref}`} title={ref}>
                  {ref}
                </span>
              ))}
              <code title={commit.hash}>{commit.shortHash}</code>
              <span>{formatDate(commit.date)}</span>
            </div>
            <div className="git-graph-subject" title={commit.subject}>
              {commit.subject}
            </div>
            <div className="git-graph-byline">
              {commit.author ?? "Unknown author"}
              {commit.parents.length > 1 ? <span>{commit.parents.length} parents</span> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function GitDetails({
  project,
  activeTab,
  onTabChange
}: {
  project: ProjectSummary;
  activeTab: GitDetailsTab;
  onTabChange: (tab: GitDetailsTab) => void;
}) {
  if (!project.git.isRepo) {
    return (
      <section className="detail-section git-details-section">
        <h3>Git Details</h3>
        <p className="subtle-line">This directory is not a git repository.</p>
      </section>
    );
  }

  return (
    <section className="detail-section git-details-section">
      <h3>Git Details</h3>
      <div className="segmented-control" role="tablist" aria-label="Git detail views">
        {gitDetailsTabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? "segment active" : "segment"}
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            role="tab"
            type="button"
          >
            <span>{tab.label}</span>
            <strong>{gitDetailsCount(project, tab.key)}</strong>
          </button>
        ))}
      </div>

      <div className="git-details-panel" role="tabpanel">
        {activeTab === "graph" ? <GitGraphList commits={project.git.graph} /> : null}
        {activeTab === "dirty" ? <DirtyChangesList files={project.git.dirtyFiles} dirty={project.git.dirty} /> : null}
        {activeTab === "branches" ? (
          <BranchesList
            branches={project.git.localBranches}
            currentBranch={project.git.currentBranch}
            localBranchCount={project.git.localBranchCount}
          />
        ) : null}
        {activeTab === "worktrees" ? (
          <WorktreesList worktrees={project.git.worktrees} worktreeCount={project.git.worktreeCount} />
        ) : null}
        {activeTab === "stashes" ? <StashesList stashes={project.git.stashes} stashCount={project.git.stashCount} /> : null}
      </div>
    </section>
  );
}

function DetailPanel({
  project,
  onOpenProject,
  onOpenDocs,
  onOpenCompliance,
  showOptionalMetadataIssues
}: {
  project?: ProjectSummary;
  onOpenProject: () => void;
  onOpenDocs: () => void;
  onOpenCompliance: () => void;
  showOptionalMetadataIssues: boolean;
}) {
  const [activeGitTab, setActiveGitTab] = useState<GitDetailsTab>("graph");

  if (!project) {
    return (
      <aside className="detail-panel">
        <EmptyState title="Select a repository" detail="Details, docs, tasks, and compliance will appear here." />
      </aside>
    );
  }

  const openTasks = openTaskCount(project);
  const visibleDocs = project.documents.filter((doc) => doc.exists).slice(0, 6);
  const visibleIssues = visibleComplianceIssues(project, showOptionalMetadataIssues);
  const optionalIssuesHidden = showOptionalMetadataIssues ? 0 : hiddenOptionalIssueCount(project);

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <div>
          <h2>{project.name}</h2>
          <p>{project.metadata.summary ?? project.path}</p>
        </div>
        <div className="detail-header-actions">
          <StatusPill tone={project.status}>{project.status}</StatusPill>
          <button type="button" onClick={onOpenProject}>
            Open Page
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="detail-grid">
        <Metric label="Open tasks" value={openTasks} />
        <Metric label="Branches" value={project.git.branchCount} />
        <Metric label="Stashes" value={project.git.stashCount} tone={project.git.stashCount ? "warning" : undefined} />
        <Metric label="Issues" value={visibleIssues.length} tone={visibleIssues.length ? "warning" : undefined} />
      </div>

      <section className="detail-section">
        <h3>Current Focus</h3>
        <p>{project.metadata.current_focus ?? "No current focus recorded."}</p>
      </section>

      <section className="detail-section">
        <h3>Activity</h3>
        <dl className="definition-list">
          <div>
            <dt>Last commit</dt>
            <dd>{formatDate(project.git.lastCommit.date)}</dd>
          </div>
          <div>
            <dt>Context</dt>
            <dd>{formatRelative(project.contextUpdatedAt)}</dd>
          </div>
          <div>
            <dt>AI update</dt>
            <dd>{formatRelative(project.lastAiUpdate)}</dd>
          </div>
        </dl>
      </section>

      <GitDetails project={project} activeTab={activeGitTab} onTabChange={setActiveGitTab} />

      <section className="detail-section">
        <div className="section-title-row">
          <h3>Documents</h3>
          <button type="button" onClick={onOpenDocs}>
            Open
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="link-list">
          {visibleDocs.length > 0 ? (
            visibleDocs.map((doc) => (
              <span key={doc.key}>
                <BookOpen size={14} aria-hidden="true" />
                {doc.label}
              </span>
            ))
          ) : (
            <p>No known documents found.</p>
          )}
        </div>
      </section>

      <section className="detail-section">
        <div className="section-title-row">
          <h3>Compliance</h3>
          <button type="button" onClick={onOpenCompliance}>
            Review
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
        {visibleIssues.length > 0 ? (
          <ul className="issue-list compact">
            {visibleIssues.slice(0, 4).map((issue) => (
              <li key={`${issue.code}-${issue.file ?? issue.message}`}>
                <AlertTriangle size={14} aria-hidden="true" />
                {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="clean-line">
            <CheckCircle2 size={15} aria-hidden="true" />
            No compliance issues found.
          </p>
        )}
        {optionalIssuesHidden > 0 ? <p className="subtle-line">{optionalIssuesHidden} optional metadata issues hidden.</p> : null}
      </section>
    </aside>
  );
}

function DashboardView({
  projects,
  allProjectCount,
  selectedProject,
  onSelect,
  onOpenProject,
  setView,
  showOptionalMetadataIssues,
  onShowOptionalMetadataIssuesChange,
  activeFilters,
  onFilterToggle,
  onClearFilters,
  sortKey,
  onSortKeyChange,
  sortDirection,
  onSortDirectionChange,
  rootFolders,
  hiddenRootFolders,
  onRootFolderToggle
}: {
  projects: ProjectSummary[];
  allProjectCount: number;
  selectedProject?: ProjectSummary;
  onSelect: (project: ProjectSummary) => void;
  onOpenProject: (project: ProjectSummary) => void;
  setView: (view: ViewKey) => void;
  showOptionalMetadataIssues: boolean;
  onShowOptionalMetadataIssuesChange: (value: boolean) => void;
  activeFilters: DashboardFilterKey[];
  onFilterToggle: (filter: DashboardFilterKey) => void;
  onClearFilters: () => void;
  sortKey: DashboardSortKey;
  onSortKeyChange: (key: DashboardSortKey) => void;
  sortDirection: SortDirection;
  onSortDirectionChange: (direction: SortDirection) => void;
  rootFolders: string[];
  hiddenRootFolders: string[];
  onRootFolderToggle: (folder: string) => void;
}) {
  return (
    <main className="workspace">
      <div className="content-column">
        <DashboardMetrics projects={projects} showOptionalMetadataIssues={showOptionalMetadataIssues} />
        <DashboardControls
          activeFilters={activeFilters}
          onFilterToggle={onFilterToggle}
          onClearFilters={onClearFilters}
          sortKey={sortKey}
          onSortKeyChange={onSortKeyChange}
          sortDirection={sortDirection}
          onSortDirectionChange={onSortDirectionChange}
          rootFolders={rootFolders}
          hiddenRootFolders={hiddenRootFolders}
          onRootFolderToggle={onRootFolderToggle}
          visibleCount={projects.length}
          totalCount={allProjectCount}
          showOptionalMetadataIssues={showOptionalMetadataIssues}
          onShowOptionalMetadataIssuesChange={onShowOptionalMetadataIssuesChange}
        />
        <RepoTable
          projects={projects}
          selectedId={selectedProject?.id}
          onSelect={onSelect}
          onOpenProject={onOpenProject}
          showOptionalMetadataIssues={showOptionalMetadataIssues}
        />
      </div>
      <DetailPanel
        project={selectedProject}
        onOpenProject={() => {
          if (selectedProject) {
            onOpenProject(selectedProject);
          }
        }}
        onOpenDocs={() => setView("docs")}
        onOpenCompliance={() => setView("compliance")}
        showOptionalMetadataIssues={showOptionalMetadataIssues}
      />
    </main>
  );
}

function RepoOverview({ project }: { project: ProjectSummary }) {
  const branch = project.git.isRepo ? (project.git.currentBranch ?? project.git.detachedHead ?? "unknown") : "not repo";
  const stack = project.metadata.stack.length ? project.metadata.stack : ["No stack recorded"];
  const tags = project.metadata.tags.length ? project.metadata.tags : ["No tags recorded"];

  return (
    <section className="repo-page-section repo-overview">
      <div>
        <h2>Briefing</h2>
        <p>{project.metadata.summary ?? "No project summary recorded."}</p>
      </div>
      <dl className="repo-facts">
        <div>
          <dt>Path</dt>
          <dd title={project.path}>{project.relativePath}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>{branch}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{project.metadata.owner ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{project.metadata.created ? formatDate(project.metadata.created) : "Unknown"}</dd>
        </div>
      </dl>
      <div className="repo-chip-group" aria-label="Stack">
        {stack.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <div className="repo-chip-group subtle" aria-label="Tags">
        {tags.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </section>
  );
}

function RepoActivity({ project }: { project: ProjectSummary }) {
  return (
    <section className="repo-page-section">
      <h2>Activity</h2>
      <dl className="definition-list roomy">
        <div>
          <dt>Last commit</dt>
          <dd>{formatDate(project.git.lastCommit.date)}</dd>
        </div>
        <div>
          <dt>Subject</dt>
          <dd>{project.git.lastCommit.subject ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Author</dt>
          <dd>{project.git.lastCommit.author ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Context updated</dt>
          <dd>{formatRelative(project.contextUpdatedAt)}</dd>
        </div>
        <div>
          <dt>Agent log</dt>
          <dd>{formatRelative(project.lastAiUpdate)}</dd>
        </div>
      </dl>
    </section>
  );
}

const workGroupLabels: Record<"staged" | "unstaged" | "untracked" | "deleted", string> = {
  staged: "Staged",
  unstaged: "Unstaged",
  untracked: "Untracked",
  deleted: "Deleted"
};

const WORK_GROUP_PREVIEW_LIMIT = 10;

function WorkFileGroup({ label, files, tone }: { label: string; files: GitDirtyFile[]; tone?: string }) {
  const visible = files.slice(0, WORK_GROUP_PREVIEW_LIMIT);
  const hidden = files.length - visible.length;

  return (
    <div className="work-group">
      <h3>
        {label}
        <span className={files.length > 0 ? `work-group-count work-group-${tone ?? "warning"}` : "work-group-count"}>
          {files.length}
        </span>
      </h3>
      {visible.length > 0 ? (
        <ul className="work-group-files">
          {visible.map((file) => (
            <li key={`${file.status}-${file.originalPath ?? ""}-${file.path}`} title={`${file.status} ${file.path}`}>
              <code>{file.status.trim()}</code>
              <span>{file.path}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="subtle-line">None.</p>
      )}
      {hidden > 0 ? <p className="subtle-line">+{hidden} more.</p> : null}
    </div>
  );
}

function RepoWorkState({ project }: { project: ProjectSummary }) {
  const groups = groupDirtyFiles(project.git.dirtyFiles);

  return (
    <section className="repo-page-section wide-section">
      <h2>Local Work State</h2>
      <div className="local-work-grid">
        <Metric label="Dirty files" value={project.git.dirtyFiles?.length ?? project.git.uncommittedCount + project.git.untrackedCount} tone={project.git.dirty ? "warning" : undefined} />
        <Metric label="Staged" value={groups.staged.length} tone={groups.staged.length ? "warning" : undefined} />
        <Metric label="Unstaged" value={groups.unstaged.length} tone={groups.unstaged.length ? "warning" : undefined} />
        <Metric label="Untracked" value={groups.untracked.length || project.git.untrackedCount} tone={groups.untracked.length || project.git.untrackedCount ? "warning" : undefined} />
        <Metric label="Deleted" value={groups.deleted.length} tone={groups.deleted.length ? "danger" : undefined} />
        <Metric label="Stashes" value={project.git.stashCount} tone={project.git.stashCount ? "warning" : undefined} />
      </div>
      {project.git.dirty ? (
        <div className="work-state-groups">
          {(Object.keys(workGroupLabels) as Array<keyof typeof workGroupLabels>).map((key) => (
            <WorkFileGroup
              files={groups[key]}
              key={key}
              label={workGroupLabels[key]}
              tone={key === "deleted" ? "danger" : "warning"}
            />
          ))}
        </div>
      ) : (
        <p className="clean-line">
          <CheckCircle2 size={15} aria-hidden="true" />
          Working tree is clean.
        </p>
      )}
    </section>
  );
}

type BranchCommitsState = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; commits: BranchCommit[] };

function BranchCommitTimeline({ state }: { state?: BranchCommitsState }) {
  if (!state || state.state === "loading") {
    return <p className="subtle-line">Loading recent commits…</p>;
  }

  if (state.state === "error") {
    return <p className="subtle-line">Unable to load commits: {state.message}</p>;
  }

  if (state.commits.length === 0) {
    return <p className="subtle-line">No commits found on this branch.</p>;
  }

  return (
    <div className="branch-timeline" role="list">
      {state.commits.map((commit) => {
        const stats = formatCommitStats(commit);
        return (
          <div className="branch-commit-row" key={commit.hash} role="listitem">
            <code title={commit.hash}>{commit.shortHash}</code>
            <div className="branch-commit-main">
              <span className="branch-commit-subject" title={commit.subject}>
                {commit.subject}
              </span>
              <span className="branch-commit-byline">
                {commit.author ?? "Unknown author"} · {formatDate(commit.date)}
                {stats ? ` · ${stats}` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RepoBranchMap({ project }: { project: ProjectSummary }) {
  const [expandedBranch, setExpandedBranch] = useState<string | undefined>(undefined);
  const [commitsByBranch, setCommitsByBranch] = useState<Record<string, BranchCommitsState>>({});
  const rows = useMemo(() => buildBranchMapRows(project), [project]);

  useEffect(() => {
    setExpandedBranch(undefined);
    setCommitsByBranch({});
  }, [project.path]);

  async function toggleBranch(row: BranchMapRow) {
    const next = expandedBranch === row.name ? undefined : row.name;
    setExpandedBranch(next);

    if (!next || !row.existsLocally || commitsByBranch[row.name]) {
      return;
    }

    setCommitsByBranch((current) => ({ ...current, [row.name]: { state: "loading" } }));

    try {
      const search = new URLSearchParams({ path: project.path, branch: row.name });
      const response = await fetch(`/api/branch-commits?${search}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
        throw new Error(body?.error ?? `Request failed with status ${response.status}.`);
      }

      const payload = (await response.json()) as BranchCommitsResponse;
      setCommitsByBranch((current) => ({ ...current, [row.name]: { state: "ready", commits: payload.commits } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setCommitsByBranch((current) => ({ ...current, [row.name]: { state: "error", message } }));
    }
  }

  if (!project.git.isRepo) {
    return null;
  }

  return (
    <section className="repo-page-section wide-section">
      <h2>Branch Map</h2>
      {project.branchIntentsExist ? null : (
        <p className="subtle-line">
          No `.devcenter/branches.yaml` found. Branch roles such as deployed or rewrite can be recorded there.
        </p>
      )}
      <div className="branch-map-list" role="list">
        {rows.map((row) => {
          const expanded = expandedBranch === row.name;
          return (
            <div className={expanded ? "branch-map-item expanded" : "branch-map-item"} key={row.name} role="listitem">
              <button
                aria-expanded={expanded}
                className="branch-map-row"
                onClick={() => void toggleBranch(row)}
                type="button"
              >
                <span className="branch-map-toggle" aria-hidden="true">
                  <ChevronRight size={14} className={expanded ? "rotated" : undefined} />
                </span>
                <span className="git-branch-name" title={row.name}>
                  {row.name}
                  {row.current ? <small>current</small> : null}
                </span>
                <span className="branch-map-chips">
                  {row.intent?.role ? <span className={`branch-role branch-role-${statusClass(row.intent.role)}`}>{row.intent.role}</span> : null}
                  {row.intent?.status ? <span className="branch-role branch-role-muted">{row.intent.status}</span> : null}
                  {!row.existsLocally ? <StatusPill tone="warning">not local</StatusPill> : null}
                  {row.branch && branchIsStale(row.branch) ? <StatusPill tone="warning">Stale</StatusPill> : null}
                </span>
                <span className="git-muted branch-map-parent">{row.intent?.parent ? `from ${row.intent.parent}` : ""}</span>
                <span className="git-muted">{row.branch ? formatAheadBehind(row.branch) : ""}</span>
                <span className="git-muted">{row.branch?.lastCommitDate ? formatRelative(row.branch.lastCommitDate) : ""}</span>
              </button>
              {expanded ? (
                <div className="branch-map-detail">
                  {row.intent?.purpose ? <p className="branch-map-purpose">{row.intent.purpose}</p> : null}
                  {row.worktreePath ?? row.intent?.worktree ? (
                    <p className="git-muted branch-map-worktree">
                      Worktree: <code>{row.worktreePath ?? row.intent?.worktree}</code>
                    </p>
                  ) : null}
                  {row.intent && row.intent.notes.length > 0 ? (
                    <ul className="branch-map-notes">
                      {row.intent.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  ) : null}
                  {row.existsLocally ? (
                    <BranchCommitTimeline state={commitsByBranch[row.name]} />
                  ) : (
                    <p className="subtle-line">This branch is recorded in branches.yaml but does not exist locally.</p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
        {rows.length === 0 ? <p className="subtle-line">No local branches found.</p> : null}
      </div>
    </section>
  );
}

function RepoTaskBoard({ project }: { project: ProjectSummary }) {
  if (project.tasks.length === 0) {
    return (
      <section className="repo-page-section">
        <h2>Tasks</h2>
        <p className="subtle-line">No tasks recorded in `.devcenter/tasks.yaml`.</p>
      </section>
    );
  }

  return (
    <section className="repo-page-section wide-section">
      <h2>Tasks</h2>
      <div className="repo-task-board">
        {(Object.keys(taskStatusLabels) as TaskStatus[]).map((status) => {
          const tasks = project.tasks.filter((task) => task.status === status);
          return (
            <section className="repo-task-lane" key={status}>
              <h3>
                {taskStatusLabels[status]}
                <span>{tasks.length}</span>
              </h3>
              {tasks.length > 0 ? (
                tasks.map((task) => (
                  <article className="task-card" key={task.id}>
                    <div className="task-card-header">
                      <strong>{task.id}</strong>
                      {task.priority ? <StatusPill tone={task.priority}>{task.priority}</StatusPill> : null}
                    </div>
                    <h4>{task.title}</h4>
                    <p>{task.notes ?? "No notes."}</p>
                    {task.branch ? <footer>{task.branch}</footer> : null}
                  </article>
                ))
              ) : (
                <p className="subtle-line">No tasks.</p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function RepoDocuments({ project, onOpenDocs }: { project: ProjectSummary; onOpenDocs: () => void }) {
  return (
    <section className="repo-page-section">
      <div className="section-title-row">
        <h2>Documents</h2>
        <button type="button" onClick={onOpenDocs}>
          Open Docs
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="repo-doc-grid">
        {project.documents.map((doc) => (
          <div className="repo-doc-row" key={doc.key}>
            <DocStatusBadge document={doc} label={doc.label} optional={doc.key !== "readme"} />
            <code title={doc.relativePath}>{doc.relativePath}</code>
            <span>{doc.exists ? formatRelative(doc.updatedAt) : "Missing"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RepoCompliance({
  project,
  onOpenCompliance,
  showOptionalMetadataIssues
}: {
  project: ProjectSummary;
  onOpenCompliance: () => void;
  showOptionalMetadataIssues: boolean;
}) {
  const issues = visibleComplianceIssues(project, showOptionalMetadataIssues);
  const optionalIssuesHidden = showOptionalMetadataIssues ? 0 : hiddenOptionalIssueCount(project);

  return (
    <section className="repo-page-section">
      <div className="section-title-row">
        <h2>Compliance</h2>
        <button type="button" onClick={onOpenCompliance}>
          Review
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      {issues.length > 0 ? (
        <ul className="issue-list">
          {issues.map((issue) => (
            <li className="repo-issue-row" key={`${issue.code}-${issue.file ?? issue.message}`}>
              <span className={`severity severity-${issue.optional ? "optional" : issue.severity}`}>
                {issue.optional ? "optional" : issue.severity}
              </span>
              <strong>{issue.message}</strong>
              {issue.file ? <code>{issue.file}</code> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="clean-line">
          <CheckCircle2 size={15} aria-hidden="true" />
          No visible compliance issues found.
        </p>
      )}
      {optionalIssuesHidden > 0 ? <p className="subtle-line">{optionalIssuesHidden} optional metadata issues hidden.</p> : null}
    </section>
  );
}

function RepositoryView({
  project,
  onBack,
  onOpenDocs,
  onOpenCompliance,
  showOptionalMetadataIssues
}: {
  project?: ProjectSummary;
  onBack: () => void;
  onOpenDocs: () => void;
  onOpenCompliance: () => void;
  showOptionalMetadataIssues: boolean;
}) {
  const [activeGitTab, setActiveGitTab] = useState<GitDetailsTab>("dirty");

  if (!project) {
    return (
      <main className="single-view">
        <EmptyState title="No repository selected" detail="Select a repository from the dashboard to open its detail page." />
      </main>
    );
  }

  return (
    <main className="repo-page">
      <div className="repo-page-heading">
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          Dashboard
        </button>
        <div>
          <h1>{project.name}</h1>
          <p>{project.path}</p>
        </div>
        <div className="repo-page-status">
          <StatusPill tone={project.status}>{project.status}</StatusPill>
          <StatusPill tone={project.git.dirty ? "warning" : "ok"}>{project.git.dirty ? "Dirty" : "Clean"}</StatusPill>
        </div>
      </div>

      <section className="repo-page-metrics" aria-label="Repository summary">
        <Metric label="Open tasks" value={openTaskCount(project)} />
        <Metric label="Branches" value={project.git.branchCount} />
        <Metric label="Worktrees" value={project.git.worktreeCount} tone={project.git.worktreeCount > 1 ? "warning" : undefined} />
        <Metric label="Ahead" value={project.git.ahead ?? 0} tone={(project.git.ahead ?? 0) > 0 ? "warning" : undefined} />
        <Metric label="Behind" value={project.git.behind ?? 0} tone={(project.git.behind ?? 0) > 0 ? "warning" : undefined} />
      </section>

      <div className="repo-page-grid">
        <RepoOverview project={project} />
        <RepoActivity project={project} />
        <section className="repo-page-section current-focus-section">
          <h2>Current Focus</h2>
          <p>{project.metadata.current_focus ?? "No current focus recorded."}</p>
        </section>
        <RepoWorkState project={project} />
        <RepoBranchMap project={project} />
        <section className="repo-page-section wide-section">
          <GitDetails project={project} activeTab={activeGitTab} onTabChange={setActiveGitTab} />
        </section>
        <RepoTaskBoard project={project} />
        <RepoDocuments project={project} onOpenDocs={onOpenDocs} />
        <RepoCompliance
          project={project}
          onOpenCompliance={onOpenCompliance}
          showOptionalMetadataIssues={showOptionalMetadataIssues}
        />
      </div>
    </main>
  );
}

function TasksView({ projects }: { projects: ProjectSummary[] }) {
  const tasks = projects.flatMap((project) =>
    project.tasks.map((task) => ({
      ...task,
      projectName: project.name,
      projectPath: project.relativePath
    }))
  );

  return (
    <main className="single-view">
      <div className="view-heading">
        <h1>Tasks</h1>
        <p>Aggregated from `.devcenter/tasks.yaml` across discovered repositories.</p>
      </div>
      <div className="kanban-grid">
        {(Object.keys(taskStatusLabels) as TaskStatus[]).map((status) => (
          <section className="task-column" key={status}>
            <h2>
              {taskStatusLabels[status]}
              <span>{tasks.filter((task) => task.status === status).length}</span>
            </h2>
            {tasks
              .filter((task) => task.status === status)
              .map((task) => (
                <article className="task-card" key={`${task.projectPath}-${task.id}`}>
                  <div className="task-card-header">
                    <strong>{task.id}</strong>
                    {task.priority ? <StatusPill tone={task.priority}>{task.priority}</StatusPill> : null}
                  </div>
                  <h3>{task.title}</h3>
                  <p>{task.notes ?? "No notes."}</p>
                  <footer>{task.projectName}</footer>
                </article>
              ))}
          </section>
        ))}
      </div>
    </main>
  );
}

function DocsView({ project }: { project?: ProjectSummary }) {
  const [selectedDoc, setSelectedDoc] = useState<ProjectDocument | undefined>();
  const [documentContent, setDocumentContent] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const firstDoc = project?.documents.find((doc) => doc.exists);
    setSelectedDoc(firstDoc);
  }, [project]);

  useEffect(() => {
    async function loadDocument() {
      if (!project || !selectedDoc?.exists) {
        setDocumentContent("");
        return;
      }

      try {
        setError("");
        const search = new URLSearchParams({ path: project.path, doc: selectedDoc.relativePath });
        const response = await fetch(`/api/document?${search}`);
        if (!response.ok) {
          throw new Error(await response.text());
        }

        const payload = (await response.json()) as DocumentResponse;
        setDocumentContent(payload.content);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load document.");
      }
    }

    void loadDocument();
  }, [project, selectedDoc]);

  if (!project) {
    return (
      <main className="single-view">
        <EmptyState title="No project selected" detail="Select a repository from the dashboard to view its documents." />
      </main>
    );
  }

  return (
    <main className="docs-view">
      <aside className="doc-list">
        <div className="view-heading compact">
          <h1>Docs</h1>
          <p>{project.name}</p>
        </div>
        {project.documents.map((doc) => (
          <button
            className={selectedDoc?.key === doc.key ? "doc-item active" : "doc-item"}
            disabled={!doc.exists}
            key={doc.key}
            onClick={() => setSelectedDoc(doc)}
            type="button"
          >
            <FileText size={15} aria-hidden="true" />
            <span>
              {doc.label}
              <small>{doc.exists ? doc.relativePath : "Missing"}</small>
            </span>
          </button>
        ))}
      </aside>
      <section className="doc-preview">
        <div className="doc-preview-header">
          <h2>{selectedDoc?.label ?? "No document"}</h2>
          <code>{selectedDoc?.relativePath ?? ""}</code>
        </div>
        {error ? <pre className="error-box">{error}</pre> : <pre>{documentContent || "No content to preview."}</pre>}
      </section>
    </main>
  );
}

function ComplianceView({
  projects,
  showOptionalMetadataIssues,
  onShowOptionalMetadataIssuesChange
}: {
  projects: ProjectSummary[];
  showOptionalMetadataIssues: boolean;
  onShowOptionalMetadataIssuesChange: (value: boolean) => void;
}) {
  const projectsWithIssues = projects.filter((project) => visibleComplianceIssues(project, showOptionalMetadataIssues).length > 0);
  const hiddenIssueCount = projects.reduce((count, project) => count + (showOptionalMetadataIssues ? 0 : hiddenOptionalIssueCount(project)), 0);

  return (
    <main className="single-view">
      <div className="view-heading heading-with-control">
        <div>
          <h1>Standards Compliance</h1>
          <p>README checks stay high-signal. Optional metadata checks are hidden until enabled.</p>
        </div>
        <label className="metadata-toggle panel-toggle" title="Show low-noise AGENTS.md and .devcenter metadata checks">
          <input
            type="checkbox"
            checked={showOptionalMetadataIssues}
            onChange={(event) => onShowOptionalMetadataIssuesChange(event.target.checked)}
          />
          <span>Show optional metadata issues</span>
        </label>
      </div>
      {projectsWithIssues.length === 0 ? (
        <EmptyState
          title="No compliance issues found"
          detail={
            hiddenIssueCount > 0
              ? "Required README and branch checks are passing. Optional metadata issues are hidden."
              : "Required README, required files, and branch naming checks are passing."
          }
        />
      ) : (
        <div className="issue-table">
          {projectsWithIssues.map((project) => (
            <section className="issue-project" key={project.id}>
              <h2>{project.name}</h2>
              <ul className="issue-list">
                {visibleComplianceIssues(project, showOptionalMetadataIssues).map((issue) => (
                  <li key={`${project.id}-${issue.code}-${issue.file ?? issue.message}`}>
                    <span className={`severity severity-${issue.optional ? "optional" : issue.severity}`}>
                      {issue.optional ? "optional" : issue.severity}
                    </span>
                    <strong>{issue.message}</strong>
                    {issue.file ? <code>{issue.file}</code> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function StandardsView({ data }: { data?: ProjectsResponse }) {
  return (
    <main className="single-view standards-view">
      <div className="view-heading">
        <h1>Standards</h1>
        <p>Defaults plus `~/.devcenter/standards.yaml` when present.</p>
      </div>
      <div className="standards-grid">
        <section>
          <h2>Required Files</h2>
          <ul>
            {data?.standards.required_files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Task Statuses</h2>
          <ul>
            {data?.standards.task_statuses.map((status) => (
              <li key={status}>{status}</li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Branch Naming</h2>
          <dl>
            {Object.entries(data?.standards.branch_naming ?? {}).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </main>
  );
}

export function App() {
  const [data, setData] = useState<ProjectsResponse>();
  const [view, setView] = useState<ViewKey>("dashboard");
  const [selectedId, setSelectedId] = useState<string>();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showOptionalMetadataIssues, setShowOptionalMetadataIssues] = useState(false);
  const [activeDashboardFilters, setActiveDashboardFilters] = useState<DashboardFilterKey[]>([]);
  const [dashboardSortKey, setDashboardSortKey] = useState<DashboardSortKey>("name");
  const [dashboardSortDirection, setDashboardSortDirection] = useState<SortDirection>("asc");
  const [hiddenRootFolders, setHiddenRootFolders] = useState<string[]>([]);

  async function loadProjects() {
    try {
      setLoading(true);
      setError("");
      const response = await fetch("/api/projects");
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as ProjectsResponse;
      setData(payload);
      setSelectedId((current) => current ?? payload.projects[0]?.id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load projects.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  function toggleDashboardFilter(filter: DashboardFilterKey) {
    if (filter === "optionalMetadataIssues") {
      setShowOptionalMetadataIssues(true);
    }

    setActiveDashboardFilters((current) => {
      if (current.includes(filter)) {
        return current.filter((item) => item !== filter);
      }

      const withoutConflict =
        filter === "dirty"
          ? current.filter((item) => item !== "clean")
          : filter === "clean"
            ? current.filter((item) => item !== "dirty")
            : current;

      return [...withoutConflict, filter];
    });
  }

  const searchFilteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query || !data) {
      return data?.projects ?? [];
    }

    return data.projects.filter((project) =>
      [project.name, project.path, project.relativePath, project.git.currentBranch, project.metadata.summary]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))
    );
  }, [data, search]);

  const rootFolders = useMemo(() => {
    return [...new Set(searchFilteredProjects.map(rootFolder))].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })
    );
  }, [searchFilteredProjects]);

  const dashboardProjects = useMemo(() => {
    const folderFiltered =
      hiddenRootFolders.length > 0
        ? searchFilteredProjects.filter((project) => !hiddenRootFolders.includes(rootFolder(project)))
        : searchFilteredProjects;

    const filtered = activeDashboardFilters.length
      ? folderFiltered.filter((project) =>
          activeDashboardFilters.every((filter) => projectMatchesDashboardFilter(project, filter))
        )
      : folderFiltered;

    return sortProjects(filtered, dashboardSortKey, dashboardSortDirection, showOptionalMetadataIssues);
  }, [
    activeDashboardFilters,
    dashboardSortDirection,
    dashboardSortKey,
    hiddenRootFolders,
    searchFilteredProjects,
    showOptionalMetadataIssues
  ]);

  const selectedProject = useMemo(() => {
    const projectSource = view === "dashboard" ? dashboardProjects : searchFilteredProjects;
    return projectSource.find((project) => project.id === selectedId) ?? projectSource[0];
  }, [dashboardProjects, searchFilteredProjects, selectedId, view]);

  return (
    <div className="app-shell">
      <Sidebar currentView={view} onChange={setView} />
      <div className="main-shell">
        <TopBar
          scanRoot={data?.scanRoot}
          generatedAt={data?.generatedAt}
          search={search}
          onSearch={setSearch}
          onRefresh={loadProjects}
          loading={loading}
        />

        {data?.warnings.length ? (
          <div className="warning-banner">
            <AlertTriangle size={16} aria-hidden="true" />
            {data.warnings.join(" ")}
          </div>
        ) : null}

        {error ? (
          <div className="warning-banner error">
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </div>
        ) : null}

        {view === "dashboard" ? (
          <DashboardView
            projects={dashboardProjects}
            allProjectCount={searchFilteredProjects.length}
            selectedProject={selectedProject}
            onSelect={(project) => setSelectedId(project.id)}
            onOpenProject={(project) => {
              setSelectedId(project.id);
              setView("repository");
            }}
            setView={setView}
            showOptionalMetadataIssues={showOptionalMetadataIssues}
            onShowOptionalMetadataIssuesChange={setShowOptionalMetadataIssues}
            activeFilters={activeDashboardFilters}
            onFilterToggle={toggleDashboardFilter}
            onClearFilters={() => setActiveDashboardFilters([])}
            sortKey={dashboardSortKey}
            onSortKeyChange={setDashboardSortKey}
            sortDirection={dashboardSortDirection}
            onSortDirectionChange={setDashboardSortDirection}
            rootFolders={rootFolders}
            hiddenRootFolders={hiddenRootFolders}
            onRootFolderToggle={(folder) =>
              setHiddenRootFolders((current) =>
                current.includes(folder) ? current.filter((item) => item !== folder) : [...current, folder]
              )
            }
          />
        ) : null}
        {view === "repository" ? (
          <RepositoryView
            project={selectedProject}
            onBack={() => setView("dashboard")}
            onOpenDocs={() => setView("docs")}
            onOpenCompliance={() => setView("compliance")}
            showOptionalMetadataIssues={showOptionalMetadataIssues}
          />
        ) : null}
        {view === "tasks" ? <TasksView projects={searchFilteredProjects} /> : null}
        {view === "docs" ? <DocsView project={selectedProject} /> : null}
        {view === "compliance" ? (
          <ComplianceView
            projects={searchFilteredProjects}
            showOptionalMetadataIssues={showOptionalMetadataIssues}
            onShowOptionalMetadataIssuesChange={setShowOptionalMetadataIssues}
          />
        ) : null}
        {view === "standards" ? <StandardsView data={data} /> : null}
      </div>
    </div>
  );
}
