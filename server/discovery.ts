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

// A main checkout has a .git directory; a linked worktree has a .git file.
async function isMainCheckout(directory: string): Promise<boolean> {
  const stats = await fs.stat(path.join(directory, ".git")).catch(() => undefined);
  return stats?.isDirectory() ?? false;
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

// Explicitly configured project paths bypass the walk, so they can live outside
// the scan root or carry names the walk skips (dot-directories). Missing paths
// and paths the walk already found are dropped.
export async function withExtraProjects(discovered: DiscoveredProject[], extraPaths: string[]): Promise<DiscoveredProject[]> {
  const projects = new Map(discovered.map((project) => [project.path, project]));

  for (const extraPath of extraPaths) {
    const resolved = path.resolve(extraPath);
    if (projects.has(resolved)) {
      continue;
    }

    const stats = await fs.stat(resolved).catch(() => undefined);
    if (!stats?.isDirectory()) {
      continue;
    }

    projects.set(resolved, { path: resolved, isRepo: await hasGitMarker(resolved) });
  }

  return [...projects.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// Several folders can link to one sidecar: linked git worktrees of a repo, or a
// second clone attached to the same home-repo project. Each would load the same
// tasks.yaml, so keep one folder per sidecar: a main checkout over a linked
// worktree, then the folder named like the sidecar, then path order.
export async function collapseSharedSidecars(projects: DiscoveredProject[]): Promise<DiscoveredProject[]> {
  const ranked = await Promise.all(
    projects.map(async (project) => {
      const sidecar = await fs.realpath(path.join(project.path, ".devcenter")).catch(() => undefined);
      return {
        project,
        sidecar,
        mainCheckout: await isMainCheckout(project.path),
        // The link targets <home>/projects/<name>/.devcenter, so the project name is the parent directory.
        namedLikeSidecar: sidecar !== undefined && path.basename(project.path) === path.basename(path.dirname(sidecar))
      };
    })
  );

  const kept = new Map<string, (typeof ranked)[number]>();
  const result: DiscoveredProject[] = [];
  for (const entry of ranked) {
    if (!entry.sidecar) {
      result.push(entry.project);
      continue;
    }

    const current = kept.get(entry.sidecar);
    if (!current || rankAbove(entry, current)) {
      kept.set(entry.sidecar, entry);
    }
  }

  return [...result, ...[...kept.values()].map((entry) => entry.project)].sort((a, b) => a.path.localeCompare(b.path));
}

function rankAbove(
  candidate: { project: DiscoveredProject; mainCheckout: boolean; namedLikeSidecar: boolean },
  current: { project: DiscoveredProject; mainCheckout: boolean; namedLikeSidecar: boolean }
): boolean {
  if (candidate.mainCheckout !== current.mainCheckout) {
    return candidate.mainCheckout;
  }
  if (candidate.namedLikeSidecar !== current.namedLikeSidecar) {
    return candidate.namedLikeSidecar;
  }
  return candidate.project.path.localeCompare(current.project.path) < 0;
}
