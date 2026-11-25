# Standards Management

DevCenter standards are file-backed so they can be read by humans, Claude Code, Codex, and other agents.

## Files

Standards layer in three levels; each deep-merges over the previous, with arrays and scalars replacing:

- Built-in defaults: `standards/defaults.yaml` in the app repo — conventions shared by every environment, shipped with the devcenter code.
- Environment overlay: `standards/global.yaml` in the DevCenter home (memory repo) — what this environment does differently (e.g. a work machine requiring PRs everywhere).
- Project overrides: `projects/<Name>/.devcenter/standards.yaml` — highest precedence for that project.
- Project-side access: every sidecar contains `global-standards.yaml`, a **generated snapshot** of the merged defaults + overlay, rewritten by attach/doctor/sync. Agents inside a project checkout read it through `.devcenter/global-standards.yaml`. Edit the source layers, never the snapshot.

## Sidecar memory model

Each managed project keeps private memory in this repo under `projects/<ProjectName>/`:

- `AGENTS.md`: agent instructions and the communication protocol (also linked as `CLAUDE.md` in the checkout).
- `.devcenter/project.yaml`: identity, status, stack, current focus, tags.
- `.devcenter/tasks.yaml`: current, blocked, and completed work.
- `.devcenter/context.md`: goals, current work, known problems, next steps.
- `.devcenter/decisions.md`: durable product and technical decisions.
- `.devcenter/agent-log.md`: dated handoff notes from agents.
- `.devcenter/standards.yaml`: project overrides of global standards.
- `.devcenter/branches.yaml`: optional branch intent (deployed branch, rewrite branch, worktree notes).

Project repos ignore the symlinks through `.git/info/exclude`, never through a tracked `.gitignore`. If a project already tracks `AGENTS.md` or `.devcenter/`, the CLI warns and prints the explicit untracking command instead of changing the project repo:

```bash
git rm -r --cached AGENTS.md .devcenter
```

Git facts come from git. Metadata explains intent git cannot know, such as which branch is deployed.

## Documentation boundary

- Public project docs (`README.md`, setup, architecture, testing) explain the product and must not reference DevCenter.
- Private memory (`AGENTS.md`, `.devcenter/`) may reference public docs, local paths, workflow notes, branch intent, task state, and handoff context.
- Project docs explain the project; DevCenter memory explains how to work on the project.

## Threads: many sessions, one shared memory

Nothing needs re-sharing when a new agent session (thread) starts on a managed project:

- **Same checkout**: a SessionStart hook runs `devcenter ensure`, which prints the project `standards.yaml` and `context.md` (capped so they fit the hook's output limit), so project rules and current state are in context before the first prompt. The larger `global-standards.yaml` is read on demand: `AGENTS.md` tells agents to read it before branching, committing, pushing, opening a PR/MR, or setting up a repo or CI. Agents without a hook follow the same file paths listed in `AGENTS.md`.
- **Parallel threads**: create a git worktree and run `devcenter attach` inside it. Attach detects linked worktrees and points the new checkout's symlinks at the *same* sidecar project (never a new one named after the worktree directory), so all threads read and write one shared memory. `.git/info/exclude` is shared between worktrees, so ignore state carries over automatically.
- **Coordination**: threads claim tasks in `tasks.yaml` (`in_progress`, optional `branch` field) so parallel work doesn't collide, and hand off through `agent-log.md` and `devcenter sync`.

## Communication protocol

Agents working inside a managed project:

1. Read `.devcenter/global-standards.yaml`, then `.devcenter/standards.yaml`, then project metadata. Project standards override global.
2. Claim tasks (`in_progress`) before working; mark them `done` after.
3. Record discovered follow-ups as new tasks before finishing.
4. Append a dated summary to `.devcenter/agent-log.md`.
5. Run `devcenter sync` so updates reach GitHub.
