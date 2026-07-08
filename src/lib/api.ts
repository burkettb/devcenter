import type { ProjectTask, TaskChanges, TaskUpdateResponse } from "../types";

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
