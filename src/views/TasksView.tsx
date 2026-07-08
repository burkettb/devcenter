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

  return (
    <div className="dc-page">
      <header className="dc-page-head">
        <div>
          <h1 className="sds-type-h3">Tasks</h1>
          <p className="dc-page-meta">
            {tasks.length} tasks from <code>.devcenter/tasks.yaml</code> across {projectCount} repositories. Click a task to see the
            full ticket and edit it.
          </p>
        </div>
      </header>

      <TaskBoard tasks={tasks} showProjectFilter onTaskSaved={onTaskSaved} />
    </div>
  );
}
