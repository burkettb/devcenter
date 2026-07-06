import fs from "node:fs/promises";
import path from "node:path";

const SKIP_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".hg",
  ".next",
  ".svn",
  "Applications",
  "Library",
  "Movies",
  "Music",
  "Pictures",
  "dist",
  "node_modules",
  "target"
]);

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasGitMarker(directory: string): Promise<boolean> {
  return exists(path.join(directory, ".git"));
}

export interface DiscoveredProject {
  path: string;
  isRepo: boolean;
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function shouldSkip(name: string): boolean {
  if (SKIP_DIRECTORIES.has(name)) {
    return true;
  }

  return name.startsWith(".") && name !== ".devcenter";
}

function isExcluded(directory: string, root: string, excludes: string[]): boolean {
  const relative = normalizeRelativePath(path.relative(root, directory));
  if (!relative || relative === ".") {
    return false;
  }

  return excludes.some((exclude) => {
    const normalized = normalizeRelativePath(exclude.replace(/^~\//, ""));
    return relative === normalized || relative.startsWith(`${normalized}/`);
  });
}

export async function discoverProjects(root: string, maxDepth: number, excludeSubdirectories: string[] = []): Promise<DiscoveredProject[]> {
  const projects = new Map<string, DiscoveredProject>();

  if (await hasGitMarker(root)) {
    projects.set(root, { path: root, isRepo: true });
    return [...projects.values()];
  }

  async function walk(directory: string, remainingDepth: number): Promise<void> {
    if (remainingDepth < 0) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !shouldSkip(entry.name))
        .map(async (entry) => {
          const fullPath = path.join(directory, entry.name);
          if (isExcluded(fullPath, root, excludeSubdirectories)) {
            return;
          }

          if (await hasGitMarker(fullPath)) {
            projects.set(fullPath, { path: fullPath, isRepo: true });
            return;
          }

          if (directory === root) {
            projects.set(fullPath, { path: fullPath, isRepo: false });
          }

          await walk(fullPath, remainingDepth - 1);
        })
    );
  }

  await walk(root, maxDepth);
  return [...projects.values()].sort((a, b) => a.path.localeCompare(b.path));
}
