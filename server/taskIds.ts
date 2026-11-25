// Task ids look like DC-042. New ids reuse the prefix the project already uses
// (projects are often renamed after their first task), and fall back to the
// project name's initials for an empty list.

function initialsPrefix(projectName: string): string {
  const initials = projectName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return initials.slice(0, 4) || "TASK";
}

export function nextTaskId(projectName: string, existingIds: string[]): string {
  let highest = 0;
  let prefix: string | undefined;
  for (const id of existingIds) {
    const match = /^([A-Za-z]+)-(\d+)$/.exec(id);
    if (match) {
      prefix = match[1].toUpperCase();
      highest = Math.max(highest, Number(match[2]));
    }
  }

  return `${prefix ?? initialsPrefix(projectName)}-${String(highest + 1).padStart(3, "0")}`;
}
