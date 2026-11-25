import { useEffect, useMemo, useState } from "react";
import { Button } from "./slate/core/Button";
import { IconButton } from "./slate/core/IconButton";
import { TopNavShell } from "./slate/dashboard/TopNavShell";
import { Alert } from "./slate/feedback/Alert";
import { Spinner } from "./slate/feedback/Spinner";
import {
  countTaskStatuses,
  formatRelative,
  projectMatchesDashboardFilter,
  rootFolder,
  type DashboardFilterKey
} from "./lib/format";
import type { ProjectsResponse, ProjectSummary, ProjectTask } from "./types";
import { DashboardView } from "./views/DashboardView";
import { RepositoryView } from "./views/RepositoryView";
import { StandardsView } from "./views/StandardsView";
import { TasksView } from "./views/TasksView";

type ViewKey = "dashboard" | "tasks" | "repo" | "standards";

const navItems: Array<{ key: ViewKey; label: string }> = [
  { key: "tasks", label: "Board" },
  { key: "dashboard", label: "Projects" }
];

export function App() {
  const [data, setData] = useState<ProjectsResponse>();
  const [view, setView] = useState<ViewKey>("tasks");
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showOptionalMetadataIssues, setShowOptionalMetadataIssues] = useState(false);
  const [activeFilters, setActiveFilters] = useState<DashboardFilterKey[]>([]);
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
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Projects could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  const projects = data?.projects ?? [];

  const rootFolders = useMemo(() => {
    return [...new Set(projects.map(rootFolder))].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })
    );
  }, [projects]);

  const dashboardProjects = useMemo(() => {
    const folderFiltered =
      hiddenRootFolders.length > 0 ? projects.filter((project) => !hiddenRootFolders.includes(rootFolder(project))) : projects;

    if (activeFilters.length === 0) {
      return folderFiltered;
    }

    return folderFiltered.filter((project) => activeFilters.every((filter) => projectMatchesDashboardFilter(project, filter)));
  }, [projects, activeFilters, hiddenRootFolders]);

  const selectedProject: ProjectSummary | undefined = useMemo(
    () => projects.find((project) => project.id === selectedId),
    [projects, selectedId]
  );

  function handleFiltersChange(next: string[]) {
    const nextFilters = next as DashboardFilterKey[];
    const added = nextFilters.find((filter) => !activeFilters.includes(filter));

    // Dirty/clean are mutually exclusive; selecting one drops the other.
    let reconciled = nextFilters;
    if (added === "dirty") {
      reconciled = nextFilters.filter((filter) => filter !== "clean");
    } else if (added === "clean") {
      reconciled = nextFilters.filter((filter) => filter !== "dirty");
    }

    if (added === "optionalMetadataIssues") {
      setShowOptionalMetadataIssues(true);
    }

    setActiveFilters(reconciled);
  }

  function openProject(project: ProjectSummary) {
    setSelectedId(project.id);
    setView("repo");
  }

  /** Patch one project's tasks in place after an edit — no full rescan needed. */
  function applyTaskUpdate(projectId: string, tasks: ProjectTask[]) {
    setData((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        projects: current.projects.map((project) =>
          project.id === projectId ? { ...project, tasks, taskCounts: countTaskStatuses(tasks) } : project
        )
      };
    });
  }

  return (
    <TopNavShell
      logo="DevCenter"
      nav={navItems.map((item) => ({ key: item.key, label: item.label, active: view === item.key }))}
      onNavigate={(item) => setView(item.key as ViewKey)}
      actions={
        <>
          <span className="dc-updated">{loading ? "Rescanning…" : `Updated ${formatRelative(data?.generatedAt).toLowerCase()}`}</span>
          <Button variant="ghost" size="sm" onClick={() => setView("standards")}>
            Standards
          </Button>
          {loading ? (
            <Spinner size="sm" label="Rescanning repositories" />
          ) : (
            <IconButton icon="arrow-path" label="Rescan Repositories" onClick={() => void loadProjects()} />
          )}
        </>
      }
    >
      {data?.warnings.length ? (
        <Alert tone="warning" style={{ marginBottom: "var(--space-4)" }}>
          {data.warnings.join(" ")}
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Projects Could Not Be Loaded" style={{ marginBottom: "var(--space-4)" }}>
          {error}
        </Alert>
      ) : null}

      {view === "dashboard" ? (
        <DashboardView
          projects={dashboardProjects}
          scanRoot={data?.scanRoot}
          generatedAt={data?.generatedAt}
          showOptionalMetadataIssues={showOptionalMetadataIssues}
          onShowOptionalMetadataIssuesChange={setShowOptionalMetadataIssues}
          activeFilters={activeFilters}
          onFiltersChange={handleFiltersChange}
          rootFolders={rootFolders}
          hiddenRootFolders={hiddenRootFolders}
          onHiddenRootFoldersChange={setHiddenRootFolders}
          onOpenProject={openProject}
        />
      ) : null}
      {view === "repo" ? (
        <RepositoryView
          project={selectedProject}
          onBack={() => setView("dashboard")}
          showOptionalMetadataIssues={showOptionalMetadataIssues}
          onTaskSaved={applyTaskUpdate}
        />
      ) : null}
      {view === "tasks" ? <TasksView projects={projects} onTaskSaved={applyTaskUpdate} /> : null}
      {view === "standards" ? <StandardsView data={data} onBack={() => setView("dashboard")} /> : null}
    </TopNavShell>
  );
}
