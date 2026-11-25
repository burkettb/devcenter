import type { ProjectTask } from "../types";

/** A paste-ready prompt that hands one ticket to an agent session. */
export function dispatchPrompt(task: ProjectTask, project: { name: string; path: string }): string {
  const lines = [
    `Work on ${task.id} in ${project.name}: ${task.title}`,
    "",
    `Repo: ${project.path}`
  ];
  if (task.branch) {
    lines.push(`Branch: ${task.branch}`);
  }
  if (task.priority) {
    lines.push(`Priority: ${task.priority}`);
  }
  if (task.notes?.trim()) {
    lines.push("", "Notes:", task.notes.trim());
  }
  lines.push(
    "",
    `Start with \`devcenter task start ${task.id}\` and read .devcenter/context.md. When you stop, set the task to done or blocked, log what happened with \`devcenter log\`, and run \`devcenter sync\`.`
  );
  return lines.join("\n");
}
