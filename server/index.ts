import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { createServer as createViteServer } from "vite";
import { loadRuntimeConfig, loadStandards } from "./config";
import { discoverProjects } from "./discovery";
import { collectProject, readProjectDocument, updateProjectTask } from "./devcenter";
import { collectBranchCommits } from "./git";
import type { BranchCommitsResponse, DocumentResponse, ProjectsResponse, TaskUpdateResponse } from "../src/types";

const isProduction = process.env.NODE_ENV === "production";

function isPathInside(parent: string, child: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  return resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}${path.sep}`);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function rootExists(scanRoot: string): Promise<boolean> {
  try {
    const stats = await fs.stat(scanRoot);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function createApp() {
  const config = await loadRuntimeConfig();
  const app = express();

  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      scanRoot: config.scanRoot,
      maxDepth: config.maxDepth,
      generatedAt: new Date().toISOString()
    });
  });

  app.get("/api/projects", async (_request, response, next) => {
    try {
      const warnings: string[] = [];
      const standards = await loadStandards();

      if (!(await rootExists(config.scanRoot))) {
        warnings.push(`Scan root does not exist: ${config.scanRoot}`);
        const payload: ProjectsResponse = {
          scanRoot: config.scanRoot,
          generatedAt: new Date().toISOString(),
          warnings,
          standards,
          projects: []
        };
        response.json(payload);
        return;
      }

      const discoveredProjects = await discoverProjects(config.scanRoot, config.maxDepth, config.excludeSubdirectories);
      const projects = await mapWithConcurrency(discoveredProjects, 4, (project) =>
        collectProject(project.path, config.scanRoot, standards, project.isRepo)
      );

      const payload: ProjectsResponse = {
        scanRoot: config.scanRoot,
        generatedAt: new Date().toISOString(),
        warnings,
        standards,
        projects
      };

      response.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/document", async (request, response, next) => {
    try {
      const projectPath = String(request.query.path ?? "");
      const relativePath = String(request.query.doc ?? "");

      if (!projectPath || !relativePath) {
        response.status(400).json({ error: "path and doc query parameters are required." });
        return;
      }

      if (!isPathInside(config.scanRoot, projectPath)) {
        response.status(403).json({ error: "Project path is outside the configured scan root." });
        return;
      }

      const content = await readProjectDocument(projectPath, relativePath);
      const payload: DocumentResponse = { projectPath, relativePath, content };
      response.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/task", async (request, response, next) => {
    try {
      const body = (request.body ?? {}) as { path?: unknown; taskId?: unknown; changes?: unknown };
      const projectPath = typeof body.path === "string" ? body.path : "";
      const taskId = typeof body.taskId === "string" ? body.taskId : "";
      const changes = body.changes && typeof body.changes === "object" ? (body.changes as Record<string, unknown>) : {};

      if (!projectPath || !taskId) {
        response.status(400).json({ error: "path and taskId are required." });
        return;
      }

      if (!isPathInside(config.scanRoot, projectPath)) {
        response.status(403).json({ error: "Project path is outside the configured scan root." });
        return;
      }

      const stringChanges: Record<string, string> = {};
      for (const key of ["title", "status", "priority", "branch", "notes"] as const) {
        if (typeof changes[key] === "string") {
          stringChanges[key] = changes[key] as string;
        }
      }

      try {
        const tasks = await updateProjectTask(projectPath, taskId, stringChanges);
        const payload: TaskUpdateResponse = { projectPath, taskId, tasks };
        response.json(payload);
      } catch (error) {
        // Task updates fail on user-correctable input (missing file, unknown
        // id, invalid status), so report them as request errors.
        response.status(400).json({ error: error instanceof Error ? error.message : "Task could not be updated." });
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/branch-commits", async (request, response, next) => {
    try {
      const projectPath = String(request.query.path ?? "");
      const branch = String(request.query.branch ?? "");

      if (!projectPath || !branch) {
        response.status(400).json({ error: "path and branch query parameters are required." });
        return;
      }

      if (!isPathInside(config.scanRoot, projectPath)) {
        response.status(403).json({ error: "Project path is outside the configured scan root." });
        return;
      }

      const commits = await collectBranchCommits(projectPath, branch);
      if (!commits) {
        response.status(404).json({ error: `Branch "${branch}" was not found in this repository.` });
        return;
      }

      const payload: BranchCommitsResponse = { projectPath, branch, commits };
      response.json(payload);
    } catch (error) {
      next(error);
    }
  });

  if (isProduction) {
    const clientDist = path.resolve(process.cwd(), "dist/client");
    app.use(express.static(clientDist));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) {
        next();
        return;
      }

      response.sendFile(path.join(clientDist, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown server error.";
    response.status(500).json({ error: message });
  });

  return { app, config };
}

const { app, config } = await createApp();

app.listen(config.port, () => {
  console.log(`DevCenter running at http://localhost:${config.port}`);
  console.log(`Scanning ${config.scanRoot} with max depth ${config.maxDepth}`);
});
