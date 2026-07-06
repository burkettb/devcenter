# DevCenter Product Plan

## Product Thesis

DevCenter is the communication layer between a developer and the AI agents working across their projects. It does not replace GitHub, Linear, Notion, Claude Code, or Codex. It centralizes three flows:

1. **Outbound**: standards, conventions, tasks, and project context reach every agent automatically through sidecar symlinks.
2. **Inbound**: task completions, new tasks, and handoff notes flow back through `tasks.yaml`, `agent-log.md`, and `devcenter sync`.
3. **Overview**: a local dashboard and `devcenter list` render project health, git state, tasks, and compliance so state is never rediscovered from scratch.

## Architecture

- Project memory lives under `projects/<Name>/` in this private repo and appears in checkouts through symlinks (`AGENTS.md`, `CLAUDE.md`, `.devcenter/`) ignored via `.git/info/exclude`. Project repos never track DevCenter files.
- Global standards live in `standards/global.yaml`; each sidecar carries a relative symlink so projects always read the current version. Project `.devcenter/standards.yaml` overrides.
- Agents communicate through CLI verbs (`devcenter task`, `devcenter log`, `devcenter sync`); the GitHub remote is the transport. No database, no webhooks, no runtime AI.
- The dashboard is a React + Vite app with a small Node server that scans local directories and runs deterministic `git` reads.
- Branch/worktree intent that git cannot know (deployed branch, rewrite branch) lives in optional `.devcenter/branches.yaml`.

## Non-Goals

- GitHub issue synchronization, AI chat, agent execution, multi-user accounts, cloud sync, authentication.

## Status

Shipped: repository discovery, deterministic git state (branches, worktrees, stashes, dirty files, graphs, branch commit timelines), sidecar memory lifecycle (attach/status/doctor/detach), communication verbs (task/log/list/sync), centralized standards, CLAUDE.md + AGENTS.md linking, dashboard with repo pages/task lanes/docs/compliance, dark flight-deck UI, private GitHub remote.

Task-level state lives in `.devcenter/tasks.yaml` (the DC-xxx list); that file is the source of truth for what's next.

## Roadmap Themes

1. **Sidecar visibility in the dashboard** — show attach state, pending memory changes, and agent-log recency per repo; expose attach/doctor/sync actions (DC-021).
2. **Standards depth** — merge project overrides into the effective standards view with source/diff display (DC-006); personal conventions view (DC-022).
3. **Freshness signals** — stale docs/context detection (DC-008), clearer stale-branch semantics (DC-018).
4. **Resume-work mode** — one scan-friendly page combining branch map, local state, recent commits, tasks, and context (DC-020).
