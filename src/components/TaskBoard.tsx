import { useMemo, useState } from "react";
import { Badge } from "../slate/core/Badge";
import { Button } from "../slate/core/Button";
import { DataTable, type DataTableColumn } from "../slate/dashboard/DataTable";
import { FilterBar, MultiSelectFilter } from "../slate/dashboard/FilterBar";
import { Alert } from "../slate/feedback/Alert";
import { Dialog } from "../slate/feedback/Dialog";
import { EmptyState } from "../slate/feedback/EmptyState";
import { Input } from "../slate/forms/Input";
import { Select } from "../slate/forms/Select";
import { Textarea } from "../slate/forms/Textarea";
import { updateTask } from "../lib/api";
import { priorityRank, priorityTone, taskStatusLabels, taskStatusOrder } from "../lib/format";
import type { ProjectTask, TaskChanges, TaskStatus } from "../types";

/** A task joined with the project it belongs to. */
export interface BoardTask extends ProjectTask {
  projectId: string;
  projectName: string;
  projectPath: string;
}

type BoardMode = "board" | "list";

const basePriorities = ["high", "medium", "low"];

function TaskCard({ task, showProject, onOpen }: { task: BoardTask; showProject: boolean; onOpen: (task: BoardTask) => void }) {
  return (
    <button className="dc-task dc-task--btn" type="button" onClick={() => onOpen(task)}>
      <span className="dc-task-meta">
        <code>{task.id}</code>
        {task.priority ? <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge> : null}
      </span>
      <span className="dc-task-title">{task.title}</span>
      {task.notes ? <span className="dc-task-notes">{task.notes}</span> : null}
      <span className="dc-task-foot">{showProject ? task.projectName : (task.branch ?? "")}</span>
    </button>
  );
}

function TaskDialog({
  task,
  onClose,
  onSaved
}: {
  task: BoardTask;
  onClose: () => void;
  onSaved: (projectId: string, tasks: ProjectTask[]) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState(task.priority ?? "");
  const [branch, setBranch] = useState(task.branch ?? "");
  const [notes, setNotes] = useState(task.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const priorityOptions = useMemo(() => {
    const options = [...basePriorities];
    if (task.priority && !options.includes(task.priority)) {
      options.unshift(task.priority);
    }
    return [{ value: "", label: "None" }, ...options.map((value) => ({ value, label: value }))];
  }, [task.priority]);

  const changes: TaskChanges = {};
  if (title !== task.title) changes.title = title;
  if (status !== task.status) changes.status = status;
  if (priority !== (task.priority ?? "")) changes.priority = priority;
  if (branch !== (task.branch ?? "")) changes.branch = branch;
  if (notes !== (task.notes ?? "")) changes.notes = notes;
  const dirty = Object.keys(changes).length > 0;

  async function save() {
    try {
      setSaving(true);
      setError("");
      const tasks = await updateTask(task.projectPath, task.id, changes);
      onSaved(task.projectId, tasks);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The task could not be saved.");
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      className="dc-task-dialog"
      title={task.id}
      description={`${task.projectName} · .devcenter/tasks.yaml`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>
            Save Changes
          </Button>
        </>
      }
    >
      <div className="dc-form">
        {error ? (
          <Alert tone="danger" title="Task Could Not Be Saved">
            {error}
          </Alert>
        ) : null}
        <Input label="Title" required value={title} onChange={(event) => setTitle(event.target.value)} />
        <div className="dc-form-row">
          <Select
            label="Status"
            value={status}
            options={taskStatusOrder.map((value) => ({ value, label: taskStatusLabels[value] }))}
            onChange={(event) => setStatus(event.target.value as TaskStatus)}
          />
          <Select label="Priority" value={priority} options={priorityOptions} onChange={(event) => setPriority(event.target.value)} />
        </div>
        <Input
          label="Branch"
          value={branch}
          placeholder="feature/some-branch"
          onChange={(event) => setBranch(event.target.value)}
        />
        <Textarea
          label="Notes"
          rows={6}
          value={notes}
          helpText="Full ticket body — agents read and append to this."
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
    </Dialog>
  );
}

export function TaskBoard({
  tasks,
  showProjectFilter = false,
  onTaskSaved
}: {
  tasks: BoardTask[];
  showProjectFilter?: boolean;
  onTaskSaved: (projectId: string, tasks: ProjectTask[]) => void;
}) {
  const [mode, setMode] = useState<BoardMode>("board");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<BoardTask | undefined>(undefined);

  const priorityOptions = useMemo(() => {
    const seen = new Set(tasks.map((task) => task.priority ?? "none"));
    const ordered = [...basePriorities.filter((value) => seen.has(value)), ...[...seen].filter((value) => !basePriorities.includes(value) && value !== "none").sort()];
    if (seen.has("none")) {
      ordered.push("none");
    }
    return ordered.map((value) => ({ key: value, label: value === "none" ? "None" : value }));
  }, [tasks]);

  const projectOptions = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.projectId, task.projectName]));
    return [...byId.entries()]
      .sort((left, right) => left[1].localeCompare(right[1], undefined, { sensitivity: "base" }))
      .map(([key, label]) => ({ key, label }));
  }, [tasks]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (statusFilter.length > 0 && !statusFilter.includes(task.status)) {
        return false;
      }
      if (priorityFilter.length > 0 && !priorityFilter.includes(task.priority ?? "none")) {
        return false;
      }
      if (projectFilter.length > 0 && !projectFilter.includes(task.projectId)) {
        return false;
      }
      if (text) {
        const haystack = [task.id, task.title, task.notes, task.branch, task.projectName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(text)) {
          return false;
        }
      }
      return true;
    });
  }, [tasks, statusFilter, priorityFilter, projectFilter, query]);

  const hasFilters = statusFilter.length > 0 || priorityFilter.length > 0 || projectFilter.length > 0 || query.trim().length > 0;

  const columns: DataTableColumn<BoardTask>[] = [
    { key: "id", header: "ID", sortable: true, mono: true, width: 110 },
    {
      key: "title",
      header: "Task",
      sortable: true,
      render: (task) => (
        <button className="dc-repo-name" type="button" onClick={() => setEditing(task)}>
          {task.title}
        </button>
      )
    },
    ...(showProjectFilter
      ? [
          {
            key: "projectName",
            header: "Project",
            sortable: true,
            render: (task: BoardTask) => <span className="dc-signals">{task.projectName}</span>
          } satisfies DataTableColumn<BoardTask>
        ]
      : []),
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (task) => taskStatusOrder.indexOf(task.status),
      render: (task) => <Badge tone={task.status === "blocked" ? "danger" : task.status === "done" ? "success" : task.status === "in_progress" ? "info" : "neutral"}>{taskStatusLabels[task.status]}</Badge>
    },
    {
      key: "priority",
      header: "Priority",
      sortable: true,
      sortValue: (task) => priorityRank(task.priority),
      render: (task) => (task.priority ? <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge> : <span className="dc-signals">—</span>)
    },
    {
      key: "branch",
      header: "Branch",
      render: (task) => (task.branch ? <span className="dc-cell-sub">{task.branch}</span> : <span className="dc-signals">—</span>)
    }
  ];

  const emptyState = (
    <EmptyState
      size="sm"
      icon="clipboard"
      title="No Tasks Match"
      description={
        hasFilters
          ? "Tasks matching the current filters will appear here. Clear a filter or the search to widen the view."
          : "Tasks from .devcenter/tasks.yaml will appear here once they are recorded."
      }
    />
  );

  return (
    <div className="dc-taskboard">
      <FilterBar
        actions={
          <div className="dc-view-toggle" role="group" aria-label="Task view">
            <Button size="sm" variant={mode === "board" ? "secondary" : "ghost"} onClick={() => setMode("board")}>
              Board
            </Button>
            <Button size="sm" variant={mode === "list" ? "secondary" : "ghost"} onClick={() => setMode("list")}>
              List
            </Button>
          </div>
        }
      >
        <MultiSelectFilter
          label="Status"
          options={taskStatusOrder.map((value) => ({ key: value, label: taskStatusLabels[value] }))}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <MultiSelectFilter label="Priority" options={priorityOptions} value={priorityFilter} onChange={setPriorityFilter} />
        {showProjectFilter && projectOptions.length > 1 ? (
          <MultiSelectFilter label="Project" options={projectOptions} value={projectFilter} onChange={setProjectFilter} />
        ) : null}
        <div className="dc-toolbar-search">
          <Input aria-label="Search tasks" placeholder="Search id, title, notes…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter([]);
              setPriorityFilter([]);
              setProjectFilter([]);
              setQuery("");
            }}
          >
            Clear Filters
          </Button>
        ) : null}
        <span className="dc-result-count">
          {filtered.length} of {tasks.length}
        </span>
      </FilterBar>

      {mode === "board" ? (
        filtered.length === 0 ? (
          emptyState
        ) : (
          <div className="dc-lanes">
            {taskStatusOrder
              .filter((status) => statusFilter.length === 0 || statusFilter.includes(status))
              .map((status) => {
                const laneTasks = filtered.filter((task) => task.status === status);
                return (
                  <section className="dc-lane" key={status}>
                    <h3>
                      {taskStatusLabels[status]}
                      <span className="dc-lane-count">{laneTasks.length}</span>
                    </h3>
                    {laneTasks.map((task) => (
                      <TaskCard key={`${task.projectId}-${task.id}`} task={task} showProject={showProjectFilter} onOpen={setEditing} />
                    ))}
                    {laneTasks.length === 0 ? <p className="dc-subtle">No tasks.</p> : null}
                  </section>
                );
              })}
          </div>
        )
      ) : (
        <DataTable<BoardTask>
          columns={columns}
          rows={filtered}
          rowKey={(task) => `${task.projectId}-${task.id}`}
          pageSize={15}
          defaultSort={{ key: "status", dir: "asc" }}
          emptyState={emptyState}
        />
      )}

      {editing ? <TaskDialog key={`${editing.projectId}-${editing.id}`} task={editing} onClose={() => setEditing(undefined)} onSaved={onTaskSaved} /> : null}
    </div>
  );
}

export function toBoardTasks(projects: Array<{ id: string; name: string; path: string; tasks: ProjectTask[] }>): BoardTask[] {
  return projects.flatMap((project) =>
    project.tasks.map((task) => ({
      ...task,
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path
    }))
  );
}
