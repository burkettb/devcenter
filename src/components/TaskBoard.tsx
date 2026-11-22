import { useEffect, useMemo, useState, type DragEvent } from "react";
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
import { createTask, deleteTask, updateTask } from "../lib/api";
import { dispatchPrompt } from "../lib/dispatch";
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

const dragType = "application/x-devcenter-task";

function TaskCard({ task, showProject, onOpen }: { task: BoardTask; showProject: boolean; onOpen: (task: BoardTask) => void }) {
  return (
    <button
      className="dc-task dc-task--btn"
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(dragType, JSON.stringify({ projectId: task.projectId, id: task.id }));
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onOpen(task)}
    >
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
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(dispatchPrompt(task, { name: task.projectName, path: task.projectPath }));
      setCopied(true);
    } catch {
      setError("The clipboard is not available in this browser.");
    }
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      setSaving(true);
      onSaved(task.projectId, await deleteTask(task.projectPath, task.id));
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The task could not be deleted.");
      setSaving(false);
    }
  }

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
          <Button variant="danger" size="sm" onClick={() => void remove()} disabled={saving}>
            {confirmDelete ? "Confirm Delete" : "Delete"}
          </Button>
          <Button variant="secondary" size="sm" leadingIcon="clipboard" onClick={() => void copyPrompt()} disabled={saving}>
            {copied ? "Prompt Copied" : "Copy Prompt"}
          </Button>
          <span className="dc-dialog-spacer" />
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

export interface BoardProject {
  id: string;
  name: string;
  path: string;
}

function NewTaskDialog({
  projects,
  onClose,
  onSaved
}: {
  projects: BoardProject[];
  onClose: () => void;
  onSaved: (projectId: string, tasks: ProjectTask[]) => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<TaskStatus>("next");
  const [priority, setPriority] = useState("medium");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const project = projects.find((candidate) => candidate.id === projectId);

  async function save() {
    if (!project) {
      return;
    }
    try {
      setSaving(true);
      setError("");
      const created = await createTask(project.path, { title, status, priority, notes });
      onSaved(project.id, created.tasks);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The task could not be created.");
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      className="dc-task-dialog"
      title="New Task"
      description={project ? `${project.name} · .devcenter/tasks.yaml` : "Pick a project"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!project || !title.trim()}>
            Create Task
          </Button>
        </>
      }
    >
      <div className="dc-form">
        {error ? (
          <Alert tone="danger" title="Task Could Not Be Created">
            {error}
          </Alert>
        ) : null}
        {projects.length > 1 ? (
          <Select
            label="Project"
            value={projectId}
            options={projects.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
            onChange={(event) => setProjectId(event.target.value)}
          />
        ) : null}
        <Input label="Title" required autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
        <div className="dc-form-row">
          <Select
            label="Status"
            value={status}
            options={taskStatusOrder.map((value) => ({ value, label: taskStatusLabels[value] }))}
            onChange={(event) => setStatus(event.target.value as TaskStatus)}
          />
          <Select
            label="Priority"
            value={priority}
            options={basePriorities.map((value) => ({ value, label: value }))}
            onChange={(event) => setPriority(event.target.value)}
          />
        </div>
        <Textarea label="Notes" rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
    </Dialog>
  );
}

/** One inbox task at a time: a accept, n next, d delete, s skip, k back. */
function TriageDialog({
  tasks,
  onClose,
  onSaved
}: {
  tasks: BoardTask[];
  onClose: () => void;
  onSaved: (projectId: string, tasks: ProjectTask[]) => void;
}) {
  // Snapshot the queue so tasks leaving the inbox don't reshuffle it mid-triage.
  const [queue] = useState(tasks);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [handled, setHandled] = useState(0);
  const task = queue[index];

  async function act(action: "accept" | "next" | "delete" | "skip" | "back") {
    if (!task || busy) {
      return;
    }
    if (action === "back") {
      setIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (action === "skip") {
      setIndex((current) => current + 1);
      return;
    }

    try {
      setBusy(true);
      setError("");
      const next =
        action === "delete"
          ? await deleteTask(task.projectPath, task.id)
          : await updateTask(task.projectPath, task.id, { status: action === "accept" ? "backlog" : "next" });
      onSaved(task.projectId, next);
      setHandled((count) => count + 1);
      setIndex((current) => current + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The task could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const map: Record<string, "accept" | "next" | "delete" | "skip" | "back"> = {
        a: "accept",
        n: "next",
        d: "delete",
        s: "skip",
        j: "skip",
        k: "back"
      };
      const action = map[event.key];
      if (action) {
        event.preventDefault();
        void act(action);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Dialog
      open
      onClose={onClose}
      className="dc-task-dialog"
      title={task ? `Inbox ${index + 1} of ${queue.length}` : "Inbox Clear"}
      description={task ? `${task.projectName} · ${task.id}` : `${handled} handled this pass.`}
      footer={
        task ? (
          <>
            <Button variant="danger" size="sm" onClick={() => void act("delete")} disabled={busy}>
              Delete (d)
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void act("skip")} disabled={busy}>
              Skip (s)
            </Button>
            <span className="dc-dialog-spacer" />
            <Button variant="secondary" onClick={() => void act("accept")} disabled={busy}>
              Backlog (a)
            </Button>
            <Button variant="primary" onClick={() => void act("next")} loading={busy}>
              Next (n)
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        )
      }
    >
      {error ? (
        <Alert tone="danger" title="Task Could Not Be Updated">
          {error}
        </Alert>
      ) : null}
      {task ? (
        <div className="dc-triage">
          <p className="dc-triage-title">{task.title}</p>
          {task.priority ? <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge> : null}
          {task.notes ? <p className="dc-triage-notes">{task.notes}</p> : <p className="dc-subtle">No notes.</p>}
        </div>
      ) : (
        <p className="dc-subtle">Every task in this pass has been handled or skipped.</p>
      )}
    </Dialog>
  );
}

export function TaskBoard({
  tasks,
  showProjectFilter = false,
  projects = [],
  onTaskSaved
}: {
  tasks: BoardTask[];
  showProjectFilter?: boolean;
  /** Projects a new task can be created in; hides the button when empty. */
  projects?: BoardProject[];
  onTaskSaved: (projectId: string, tasks: ProjectTask[]) => void;
}) {
  const [mode, setMode] = useState<BoardMode>("board");
  const [showDone, setShowDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const [dropTarget, setDropTarget] = useState<TaskStatus | undefined>(undefined);
  const [moveError, setMoveError] = useState("");
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

  const inboxTasks = useMemo(() => filtered.filter((task) => task.status === "inbox"), [filtered]);
  const laneStatuses = taskStatusOrder.filter((status) =>
    statusFilter.length > 0 ? statusFilter.includes(status) : status !== "done" || showDone
  );

  async function moveTask(event: DragEvent<HTMLElement>, status: TaskStatus) {
    event.preventDefault();
    setDropTarget(undefined);
    const raw = event.dataTransfer.getData(dragType);
    if (!raw) {
      return;
    }
    const { projectId, id } = JSON.parse(raw) as { projectId: string; id: string };
    const task = tasks.find((candidate) => candidate.projectId === projectId && candidate.id === id);
    if (!task || task.status === status) {
      return;
    }
    try {
      setMoveError("");
      onTaskSaved(task.projectId, await updateTask(task.projectPath, task.id, { status }));
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : "The task could not be moved.");
    }
  }

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
          <div className="dc-board-actions">
            {inboxTasks.length > 0 ? (
              <Button size="sm" variant="secondary" onClick={() => setTriaging(true)}>
                Triage Inbox ({inboxTasks.length})
              </Button>
            ) : null}
            {mode === "board" && statusFilter.length === 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setShowDone((current) => !current)}>
                {showDone ? "Hide Done" : "Show Done"}
              </Button>
            ) : null}
            {projects.length > 0 ? (
              <Button size="sm" variant="primary" leadingIcon="plus" onClick={() => setCreating(true)}>
                New Task
              </Button>
            ) : null}
          <div className="dc-view-toggle" role="group" aria-label="Task view">
            <Button size="sm" variant={mode === "board" ? "secondary" : "ghost"} onClick={() => setMode("board")}>
              Board
            </Button>
            <Button size="sm" variant={mode === "list" ? "secondary" : "ghost"} onClick={() => setMode("list")}>
              List
            </Button>
          </div>
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
          <div className="dc-lanes" style={{ gridTemplateColumns: `repeat(${laneStatuses.length}, minmax(0, 1fr))` }}>
            {laneStatuses.map((status) => {
                const laneTasks = filtered.filter((task) => task.status === status);
                return (
                  <section
                    className={`dc-lane${dropTarget === status ? " dc-lane--drop" : ""}`}
                    key={status}
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes(dragType)) {
                        event.preventDefault();
                        setDropTarget(status);
                      }
                    }}
                    onDragLeave={() => setDropTarget((current) => (current === status ? undefined : current))}
                    onDrop={(event) => void moveTask(event, status)}
                  >
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

      {moveError ? (
        <Alert tone="danger" title="Task Could Not Be Moved" style={{ marginTop: "var(--space-3)" }}>
          {moveError}
        </Alert>
      ) : null}
      {creating ? <NewTaskDialog projects={projects} onClose={() => setCreating(false)} onSaved={onTaskSaved} /> : null}
      {triaging ? <TriageDialog tasks={inboxTasks} onClose={() => setTriaging(false)} onSaved={onTaskSaved} /> : null}
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
