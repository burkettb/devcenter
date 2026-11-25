#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {
  attachSidecar,
  commitSidecar,
  detachSidecar,
  doctorSidecar,
  ensureSidecar,
  pushDevCenter,
  statusSidecar,
  type SidecarResult
} from "./sidecar";
import { expandTilde, homeConfigPath, resolveDevCenterHome, writeConfiguredHome } from "./home";
import {
  addTask,
  appendAgentLog,
  listProjects,
  listTasks,
  setTaskStatus,
  syncMemory,
  taskStatuses
} from "./memory";
import {
  boardStatusLine,
  installService,
  openBoard,
  restartService,
  serviceStatus,
  uninstallService,
  type ServiceResult
} from "./service";

function usage(): string {
  return `Usage: devcenter <command> [arguments] [options]

Project memory (run inside a project, or pass a path):
  attach [path]                   Attach sidecar memory (AGENTS.md, CLAUDE.md, .devcenter/).
  status [path]                   Inspect sidecar links, ignore state, and pending changes.
  doctor [path]                   Repair missing sidecar files, symlinks, and exclude entries.
  detach [path] [--clean-exclude] Remove local sidecar symlinks.
  ensure [path]                   Hook-friendly attach check: silent outside git repos,
                                  restores links for known projects, hints when unmanaged.

Communication:
  task list                       Show open tasks for this project.
  task add <title> [options]      Add a task (--priority, --status, --notes, --branch).
  task start <id>                 Mark a task in_progress.
  task done <id>                  Mark a task done.
  task set <id> <status>          Set any status (${taskStatuses.join(", ")}).
  log <message>                   Append a dated note to this project's agent log.

Board:
  open                            Open the board in a browser.
  service install                 Build the app and run the board at login (launchd).
  service restart                 Rebuild and restart the board (after pulling updates).
  service status                  Show whether the board service is installed and up.
  service uninstall               Stop the board and remove the launchd agent.

DevCenter repo:
  list                            Summarize all attached projects and task counts.
  sync [-m msg]                   Commit memory changes, pull --rebase, and push.
  commit [path] [-m msg]          Commit only this project's memory.
  push                            Push the DevCenter repo.
  home [path]                     Show the resolved DevCenter home (memory repo), or set
                                  it in ~/.devcenter/config.json. DEVCENTER_HOME overrides.

Options:
  -m, --message <message>         Commit message.
  --clean-exclude                 With detach, remove local exclude entries.
  -h, --help                      Show this help.
`;
}

function printResult(result: { messages: string[]; warnings: string[] }): void {
  for (const message of result.messages) {
    if (message) {
      console.log(message);
    }
  }

  for (const warning of result.warnings) {
    if (warning) {
      console.warn(`warning: ${warning}`);
    }
  }
}

function takePath(args: string[]): string {
  const pathArg = args.find((arg) => !arg.startsWith("-"));
  return pathArg ?? ".";
}

function takeOption(args: string[], names: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    if (names.includes(args[index])) {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error(`${args[index]} requires a value.`);
      }
      args.splice(index, 2);
      return value;
    }
  }

  return undefined;
}

async function runServiceCommand(args: string[]): Promise<ServiceResult> {
  const [subcommand] = args;
  switch (subcommand) {
    case "install":
      return installService();
    case "restart":
      return restartService();
    case "uninstall":
      return uninstallService();
    case "status":
    case undefined:
      return serviceStatus();
    default:
      throw new Error(`Unknown service subcommand: ${subcommand}`);
  }
}

async function runTaskCommand(args: string[]): Promise<SidecarResult> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "list":
    case undefined:
      return listTasks(".");
    case "add": {
      const priority = takeOption(rest, ["-p", "--priority"]);
      const status = takeOption(rest, ["--status"]);
      const notes = takeOption(rest, ["-n", "--notes"]);
      const branch = takeOption(rest, ["-b", "--branch"]);
      const title = rest.filter((arg) => !arg.startsWith("-")).join(" ");
      return addTask(".", title, { priority, status, notes, branch });
    }
    case "start": {
      const [id] = rest;
      if (!id) {
        throw new Error("task start requires a task id.");
      }
      return setTaskStatus(".", id, "in_progress");
    }
    case "done": {
      const [id] = rest;
      if (!id) {
        throw new Error("task done requires a task id.");
      }
      return setTaskStatus(".", id, "done");
    }
    case "set": {
      const [id, status] = rest;
      if (!id || !status) {
        throw new Error("task set requires a task id and a status.");
      }
      return setTaskStatus(".", id, status);
    }
    default:
      throw new Error(`Unknown task subcommand: ${subcommand}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;

  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return command ? 0 : 1;
  }

  switch (command) {
    case "attach": {
      const result = await attachSidecar(takePath(args));
      printResult(result);
      return result.exitCode;
    }
    case "status": {
      const result = await statusSidecar(takePath(args));
      result.messages.push(await boardStatusLine());
      printResult(result);
      return result.exitCode;
    }
    case "doctor": {
      const result = await doctorSidecar(takePath(args));
      printResult(result);
      return result.exitCode;
    }
    case "detach": {
      const cleanExclude = args.includes("--clean-exclude");
      const result = await detachSidecar(takePath(args.filter((arg) => arg !== "--clean-exclude")), { cleanExclude });
      printResult(result);
      return result.exitCode;
    }
    case "task": {
      const result = await runTaskCommand(args);
      printResult(result);
      return result.exitCode;
    }
    case "log": {
      const message = args.join(" ");
      const result = await appendAgentLog(".", message);
      printResult(result);
      return result.exitCode;
    }
    case "list": {
      const result = await listProjects();
      printResult(result);
      return result.exitCode;
    }
    case "sync": {
      const message = takeOption(args, ["-m", "--message"]);
      const result = await syncMemory(undefined, message);
      printResult(result);
      return result.exitCode;
    }
    case "commit": {
      const message = takeOption(args, ["-m", "--message"]);
      const result = await commitSidecar(takePath(args), message);
      printResult(result);
      return result.exitCode;
    }
    case "push": {
      const result = await pushDevCenter();
      printResult(result);
      return result.exitCode;
    }
    case "ensure": {
      const result = await ensureSidecar(takePath(args));
      // Only attached projects get the board line; ensure stays quiet elsewhere.
      if (result.messages.some((message) => message.includes("attached"))) {
        result.messages.push(await boardStatusLine());
      }
      printResult(result);
      return result.exitCode;
    }
    case "service": {
      const result = await runServiceCommand(args);
      printResult(result);
      return result.exitCode;
    }
    case "open": {
      const result = await openBoard();
      printResult(result);
      return result.exitCode;
    }
    case "home": {
      const target = args.find((arg) => !arg.startsWith("-"));
      if (target) {
        const resolved = path.resolve(expandTilde(target));
        const configPath = await writeConfiguredHome(resolved);
        console.log(`DevCenter home set to ${resolved} (${configPath})`);
        return 0;
      }

      const resolution = await resolveDevCenterHome();
      const sourceLabel =
        resolution.source === "env"
          ? "DEVCENTER_HOME"
          : resolution.source === "config"
            ? homeConfigPath()
            : "app repo fallback";
      console.log(`${resolution.home} (from ${sourceLabel})`);
      return 0;
    }
    default:
      throw new Error(`Unknown command: ${command}. Run devcenter --help.`);
  }
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    process.exitCode = 1;
  });
