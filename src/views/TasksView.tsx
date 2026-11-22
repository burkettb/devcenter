import { useMemo } from "react";
import { TaskBoard, toBoardTasks } from "../components/TaskBoard";
import type { ProjectSummary, ProjectTask } from "../types";

export function TasksView({
  projects,
  onTaskSaved
}: {
  projects: ProjectSummary[];
  onTaskSaved: (projectId: string, tasks: ProjectTask[]) => void;
}) {
  const tasks = useMemo(() => toBoardTasks(projects), [projects]);
  const projectCount = useMemo(() => new Set(tasks.map((task) => task.projectId)).size, [tasks]);
  // Attached projects (sidecar project.yaml present) can take new tasks.
  const attached = useMemo(
    () =>
      projects
        .filter((project) => project.metadataExists)
        .map((project) => ({ id: project.id, name: project.name, path: project.path }))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" })),
    [projects]
  );
  const inboxCount = tasks.filter((task) => task.status === "inbox").length;

  return (
    <div className="dc-page">
      <header className="dc-page-head">
        <div>
          <h1 className="sds-type-h3">Board</h1>
          <p className="dc-page-meta">
            {tasks.length} tasks across {projectCount} projects{inboxCount ? `, ${inboxCount} waiting in the inbox` : ""}. Drag a card to
            change its status, or click it to edit, delete, or copy a prompt for an agent.
          </p>
        </div>
      </header>

      <TaskBoard tasks={tasks} showProjectFilter projects={attached} onTaskSaved={onTaskSaved} />
    </div>
  );
}
