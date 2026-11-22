import type { ProjectTask, TaskChanges, TaskCreateResponse, TaskUpdateResponse } from "../types";

export async function updateTask(projectPath: string, taskId: string, changes: TaskChanges): Promise<ProjectTask[]> {
  const response = await fetch("/api/task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: projectPath, taskId, changes })
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Request failed with status ${response.status}.`);
  }

  return ((await response.json()) as TaskUpdateResponse).tasks;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

export interface NewTaskInput {
  title: string;
  status?: string;
  priority?: string;
  notes?: string;
}

export async function createTask(projectPath: string, input: NewTaskInput): Promise<TaskCreateResponse> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: projectPath, ...input })
  });
  return readJson<TaskCreateResponse>(response);
}

export async function deleteTask(projectPath: string, taskId: string): Promise<ProjectTask[]> {
  const query = new URLSearchParams({ path: projectPath, taskId });
  const response = await fetch(`/api/task?${query.toString()}`, { method: "DELETE" });
  return (await readJson<TaskUpdateResponse>(response)).tasks;
}
