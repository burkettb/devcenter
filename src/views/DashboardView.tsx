import { useMemo } from "react";
import { Badge } from "../slate/core/Badge";
import { Button } from "../slate/core/Button";
import { DataTable, type DataTableColumn } from "../slate/dashboard/DataTable";
import { FilterBar, MultiSelectFilter } from "../slate/dashboard/FilterBar";
import { StatCard } from "../slate/dashboard/StatCard";
import { EmptyState } from "../slate/feedback/EmptyState";
import { Switch } from "../slate/forms/Switch";
import {
  complianceIssueCount,
  dashboardFilterOptions,
  dashboardSignals,
  documentState,
  formatRelative,
  openTaskCount,
  repoStateTone,
  type DashboardFilterKey
} from "../lib/format";
import type { ProjectSummary } from "../types";

interface RepoRow {
  id: string;
  name: string;
  path: string;
  branch: string;
  state: string;
  signals: string;
  issues: number;
  tasks: number;
  lastChange: string;
  lastCommit: string;
  project: ProjectSummary;
}

function buildRows(projects: ProjectSummary[], showOptionalMetadataIssues: boolean): RepoRow[] {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    path: project.relativePath,
    branch: project.git.isRepo ? (project.git.currentBranch ?? project.git.detachedHead ?? "unknown") : "",
    state: repoStateTone(project).label,
    signals: dashboardSignals(project).join(" · "),
    issues: complianceIssueCount(project, showOptionalMetadataIssues),
    tasks: openTaskCount(project),
    lastChange: project.lastChange ?? project.lastModified ?? "",
    lastCommit: project.git.lastCommit.date ?? "",
    project
  }));
}

export function DashboardView({
  projects,
  scanRoot,
  generatedAt,
  showOptionalMetadataIssues,
  onShowOptionalMetadataIssuesChange,
  activeFilters,
  onFiltersChange,
  rootFolders,
  hiddenRootFolders,
  onHiddenRootFoldersChange,
  onOpenProject
}: {
  projects: ProjectSummary[];
  scanRoot?: string;
  generatedAt?: string;
  showOptionalMetadataIssues: boolean;
  onShowOptionalMetadataIssuesChange: (value: boolean) => void;
  activeFilters: DashboardFilterKey[];
  onFiltersChange: (next: string[]) => void;
  rootFolders: string[];
  hiddenRootFolders: string[];
  onHiddenRootFoldersChange: (next: string[]) => void;
  onOpenProject: (project: ProjectSummary) => void;
}) {
  const rows = useMemo(() => buildRows(projects, showOptionalMetadataIssues), [projects, showOptionalMetadataIssues]);

  const dirtyCount = projects.filter((project) => project.git.dirty).length;
  const issueCount = projects.reduce((count, project) => count + complianceIssueCount(project, showOptionalMetadataIssues), 0);
  const blockedCount = projects.reduce((count, project) => count + project.taskCounts.blocked, 0);
  const hasActiveFilters = activeFilters.length > 0 || hiddenRootFolders.length > 0;

  const columns: DataTableColumn<RepoRow>[] = [
    {
      key: "name",
      header: "Repository",
      sortable: true,
      render: (row) => (
        <div className="dc-repo-cell">
          <button className="dc-repo-name" type="button" onClick={() => onOpenProject(row.project)}>
            {row.name}
          </button>
          <span className="dc-cell-sub">{row.path}</span>
        </div>
      )
    },
    {
      key: "branch",
      header: "Branch",
      render: (row) => (row.branch ? <span className="dc-branch-name">{row.branch}</span> : <span className="dc-signals">—</span>)
    },
    {
      key: "state",
      header: "State",
      sortable: true,
      render: (row) => {
        const state = repoStateTone(row.project);
        return <Badge tone={state.tone}>{state.label}</Badge>;
      }
    },
    {
      key: "signals",
      header: "Signals",
      render: (row) => <span className="dc-signals">{row.signals || "—"}</span>
    },
    {
      key: "docs",
      header: "Docs",
      render: (row) => {
        const readme = row.project.documents.find((doc) => doc.key === "readme");
        const agents = row.project.documents.find((doc) => doc.key === "agents");
        const readmeState = documentState(readme);
        const agentsState = documentState(agents);
        return (
          <span className="dc-doc-badges">
            <Badge boxed tone={readmeState.tone}>
              README
            </Badge>
            <Badge boxed tone={agentsState.tone === "success" ? "success" : "neutral"}>
              AGENTS
            </Badge>
          </span>
        );
      }
    },
    { key: "issues", header: "Issues", sortable: true, align: "right" },
    { key: "tasks", header: "Tasks", sortable: true, align: "right" },
    {
      key: "lastChange",
      header: "Last Change",
      sortable: true,
      sortValue: (row) => (row.lastChange ? Date.parse(row.lastChange) : 0),
      render: (row) => <span className="dc-signals">{formatRelative(row.lastChange || undefined)}</span>
    },
    {
      key: "lastCommit",
      header: "Last Commit",
      sortable: true,
      sortValue: (row) => (row.lastCommit ? Date.parse(row.lastCommit) : 0),
      render: (row) => <span className="dc-signals">{formatRelative(row.lastCommit || undefined)}</span>
    }
  ];

  return (
    <div className="dc-page">
      <header className="dc-page-head">
        <div>
          <h1 className="sds-type-h3">Dashboard</h1>
          <p className="dc-page-meta">
            Scanning <code>{scanRoot ?? "…"}</code> · updated {formatRelative(generatedAt).toLowerCase()}
          </p>
        </div>
      </header>

      <div className="dc-stats" aria-label="Repository summary">
        <StatCard label="Repositories" value={projects.length} />
        <StatCard label="Dirty Working Trees" value={dirtyCount} />
        <StatCard label="Compliance Issues" value={issueCount} />
        <StatCard label="Blocked Tasks" value={blockedCount} />
      </div>

      <FilterBar
        actions={
          <Switch
            label="Optional Checks"
            checked={showOptionalMetadataIssues}
            onChange={(event) => onShowOptionalMetadataIssuesChange(event.target.checked)}
          />
        }
      >
        <MultiSelectFilter
          label="Filters"
          options={dashboardFilterOptions.map((option) => ({ key: option.key, label: option.label }))}
          value={activeFilters}
          onChange={onFiltersChange}
        />
        {rootFolders.length > 1 ? (
          <MultiSelectFilter
            label="Hide Folders"
            options={rootFolders}
            value={hiddenRootFolders}
            onChange={onHiddenRootFoldersChange}
          />
        ) : null}
        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onFiltersChange([]);
              onHiddenRootFoldersChange([]);
            }}
          >
            Clear Filters
          </Button>
        ) : null}
      </FilterBar>

      <DataTable<RepoRow>
        columns={columns}
        rows={rows}
        rowKey="id"
        filterable
        title="Repositories"
        searchPlaceholder="Search name, path, or branch…"
        pageSize={10}
        defaultSort={{ key: "lastChange", dir: "desc" }}
        emptyState={
          <EmptyState
            size="sm"
            icon="magnifying-glass"
            title="No Repositories Match"
            description="Repositories under the scan root will appear here. Clear the search or filters to see them."
          />
        }
      />
    </div>
  );
}
