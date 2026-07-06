#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const devcenterRoot = path.resolve(scriptDirectory, "..");
const tsxLoader = path.join(devcenterRoot, "node_modules", "tsx", "dist", "loader.mjs");
const cliEntry = path.join(devcenterRoot, "server", "cli.ts");

const result = spawnSync(
  process.execPath,
  ["--import", pathToFileURL(tsxLoader).href, cliEntry, ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  }
);

if (result.error) {
  console.error(`error: ${result.error.message}`);
  process.exitCode = 1;
} else if (typeof result.status === "number") {
  process.exitCode = result.status;
} else if (result.signal) {
  process.kill(process.pid, result.signal);
}
