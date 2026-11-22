# DevCenter

DevCenter is a communication layer between you and the AI agents working across your projects. Standards, project context, and tasks flow out to every agent automatically; task updates and handoff notes flow back — all through plain files in git, with a local dashboard on top.

Every managed project gets a **sidecar**: private memory stored in your DevCenter *home* repo and symlinked into the project checkout. Agents launched inside a project automatically read the shared standards, current context, and open tasks — and write back task updates and handoff notes. The project repo's own git never sees any of it.

## The two-repo model

DevCenter separates the **app** (this repo, public, stateless) from your **home** (a private repo holding all memory):

```
devcenter (this repo — the app)
├── standards/defaults.yaml          ← built-in conventions every environment inherits
├── server/                          ← CLI + scan server
├── src/                             ← dashboard
└── docs/                            ← product and setup docs

your DevCenter home (private repo, e.g. devcenter-personal)
├── standards/global.yaml            ← environment overlay (what this environment does differently)
└── projects/<name>/
    ├── AGENTS.md                    ← agent instructions + protocol
    └── .devcenter/
        ├── project.yaml             ← identity, status, current focus
        ├── tasks.yaml               ← task list (agents update this)
        ├── context.md               ← state, problems, next steps
        ├── decisions.md             ← durable decisions
        ├── agent-log.md             ← dated agent handoff notes
        ├── standards.yaml           ← project-specific overrides
        └── global-standards.yaml    ← generated snapshot of defaults + overlay

project checkout (e.g. ~/dev/MyApp)
├── AGENTS.md  → symlink into sidecar   (read by Codex etc.)
├── CLAUDE.md  → symlink to AGENTS.md   (read by Claude Code)
└── .devcenter → symlink into sidecar
```

The symlinks are ignored through each project's `.git/info/exclude`, so nothing DevCenter-related is ever tracked or pushed by the project repo. One app install serves whichever home belongs on that machine — so a personal device and a work device can share the app and the built-in conventions while keeping their memory completely separate. See [docs/SETUP.md](docs/SETUP.md).

## Setup

```bash
git clone <this repo> ~/dev/devcenter
cd ~/dev/devcenter
npm install
npm link                                  # puts `devcenter` on your PATH

# create (or clone) your private home repo, then point this machine at it:
devcenter home ~/dev/devcenter-personal
```

Full first-time, second-device, and work-environment walkthroughs — including Claude Code and Codex hook wiring — are in [docs/SETUP.md](docs/SETUP.md).

## CLI

Attach a project (run inside it, or pass a path):

```bash
devcenter attach            # create sidecar memory + symlinks
devcenter status            # inspect links, ignore state, pending changes
devcenter doctor            # repair links, missing files, exclude entries
devcenter detach            # remove local symlinks (memory stays in the home)
devcenter ensure            # hook-friendly: silent outside git repos, restores
                            # links for known projects, hints when unmanaged
```

Communicate (agents and humans, from inside any attached project):

```bash
devcenter task list
devcenter task add "Fix flaky auth test" --priority high   # lands in the inbox
devcenter task start MA-001
devcenter task done MA-001
devcenter task rm MA-002
devcenter task sweep --all --dry-run   # preview moving backlog into the inbox
devcenter log "Refactored auth middleware; tests green."
```

Across all projects:

```bash
devcenter list              # every project, status, and task counts
devcenter sync              # refresh standards snapshots, commit memory, pull --rebase, push
devcenter home [path]       # show or set this machine's DevCenter home
```

## The agent protocol

Each sidecar `AGENTS.md` instructs agents to:

1. Read global standards, project overrides, context, and tasks before working.
2. Claim a task (`in_progress`) when one covers their work.
3. Before finishing: mark tasks done, add tasks for discovered follow-ups, append a dated `agent-log.md` summary, refresh `context.md`, and run `devcenter sync`.

New tasks start in the `inbox` status. Triage them on the board (accept to backlog, move to next, or delete, one key each) so agent-proposed follow-ups never pile up unreviewed. Task completions and new tasks flow back through `tasks.yaml` and `agent-log.md`, land in the home repo via `devcenter sync`, and show up in the dashboard and `devcenter list`.

## Standards

Standards layer in three levels, each deep-merging over the previous (arrays and scalars replace):

1. **Built-in defaults** — [standards/defaults.yaml](standards/defaults.yaml), shipped with the app: commit format, pushing/branching rules, gitignore hygiene, CI/CD shape.
2. **Environment overlay** — `standards/global.yaml` in your home repo: what this environment does differently (e.g. a work machine requiring PRs everywhere).
3. **Project overrides** — each sidecar's `.devcenter/standards.yaml`.

Attach, doctor, and sync materialize the merged first two layers into each sidecar's `global-standards.yaml` — a generated snapshot agents read through the project checkout. Edit the sources and run `devcenter sync`; never edit the snapshot.

## Dashboard

```bash
npm run dev     # http://localhost:4173
```

Scans `~/dev` by default and renders repository health (branches, dirty state, ahead/behind, stashes, worktrees), aggregated tasks, docs, standards compliance, and per-repo pages with branch maps and commit timelines.

Override the scan root with `DEV_CENTER_ROOT=/path npm run dev`, or copy `devcenter.config.example.json` to `devcenter.config.json`:

```json
{
  "scanRoot": "~/dev",
  "maxDepth": 3,
  "port": 4173,
  "excludeSubdirectories": []
}
```

## Development

```bash
npm test           # node test runner over server/*.test.ts
npm run build      # typecheck + vite build
```
