# Environment Setup

DevCenter is one app serving one **home** per environment. The app repo is public and stateless; each home is a private repo holding that environment's memory (`projects/*`) and standards overlay (`standards/global.yaml`). Environments never reference each other — a personal home lives on your personal git host, a work home on your employer's.

How the app finds the home, in order:

1. `DEVCENTER_HOME` environment variable
2. `~/.devcenter/config.json` — written by `devcenter home <path>`
3. Fallback: the repo the app code lives in (single-repo layouts)

## First-time setup (any machine)

```bash
# 1. Install the app
git clone <app repo> ~/dev/devcenter
cd ~/dev/devcenter && npm install && npm link

# 2. Create the home repo (skip if cloning an existing one)
mkdir ~/dev/devcenter-personal && cd ~/dev/devcenter-personal
git init && git commit --allow-empty -m "chore: initialize devcenter home"
# create a PRIVATE remote for it and push

# 3. Point this machine at the home
devcenter home ~/dev/devcenter-personal

# 4. Attach projects (run inside each repo)
cd ~/dev/some-project && devcenter attach
```

`devcenter attach` bootstraps everything missing in the home: `standards/global.yaml` (an empty overlay you can edit later) and the project's sidecar files.

## Second device, same environment

```bash
git clone <app repo> ~/dev/devcenter && cd ~/dev/devcenter && npm install && npm link
git clone <your home repo> ~/dev/devcenter-personal
devcenter home ~/dev/devcenter-personal
```

Then in each project clone, `devcenter attach` (or let the `ensure` hook below do it — projects already known to the home are re-linked automatically).

## Work environment

Keep work and personal fully separate: the work home lives on **work git infrastructure** and work memory never touches personal accounts. The app repo and its built-in defaults (commit format, gitignore hygiene, CI shape) are shared; the overlay is where the environments differ.

```bash
# on the work machine
git clone <app repo> ~/dev/devcenter && cd ~/dev/devcenter && npm install && npm link
mkdir ~/dev/devcenter-work && cd ~/dev/devcenter-work
git init && git commit --allow-empty -m "chore: initialize devcenter home"
# create a private repo on WORK infrastructure and push
devcenter home ~/dev/devcenter-work
```

Then edit `~/dev/devcenter-work/standards/global.yaml` with the stricter collaborative posture. A typical work overlay:

```yaml
version: 2
metadata:
  name: Work Standards Overlay
  description: Work-environment overrides layered on the devcenter defaults.

pull_requests:
  solo_repos:
    - Always open a PR; never push directly to main. Work repos are treated as shared.
  shared_repos:
    - Always open a PR; never push directly to main.

branching:
  when_to_commit_to_main: []   # never — everything goes through a branch

licensing:
  default: Follow employer policy; never add or change licenses unilaterally.
  rules:
    - Licensing decisions belong to the employer, not the agent.
```

Objects deep-merge and arrays/scalars replace, so everything not listed (commits, pushing, gitignore, CI phases) inherits the defaults unchanged. Run `devcenter sync` after editing so every attached project's snapshot refreshes.

## Wiring agents (per machine)

### Claude Code

Add a `SessionStart` hook to `~/.claude/settings.json` so every session in every repo checks DevCenter automatically:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "command -v devcenter >/dev/null && devcenter ensure || true",
            "timeout": 30,
            "statusMessage": "Checking DevCenter sidecar"
          }
        ]
      }
    ]
  }
}
```

`devcenter ensure` is silent outside git repos, prints a one-line context summary in attached repos, restores symlinks for projects the home already knows (fresh clones), and hints — without side effects — in unmanaged repos.

No `~/.claude/CLAUDE.md` entry is needed: attached repos expose a `CLAUDE.md` symlink that Claude Code loads automatically, and it `@`-imports the standards snapshot, project overrides, and context.

### Codex

Codex reads the global `~/.codex/AGENTS.md` in every session. Add:

```markdown
## DevCenter (project memory and standards)

At the start of every session inside a git repository, run `devcenter ensure` and read its output before doing anything else.

- If it reports the project is attached, the repo's `AGENTS.md` and `.devcenter/` contain the standards, context, and tasks — read them and follow them.
- If it reports the repo is not managed, ask before running `devcenter attach`; do not attach on your own.
- If the `devcenter` command is missing, skip this silently.
```

### Other agents

Any agent that reads `AGENTS.md` at the repo root gets the same instructions through the sidecar symlink — no global config needed. For agents with a session-start hook mechanism, wire `devcenter ensure` the same way as Claude Code.

## Checklist

Per machine: app cloned + `npm install` + `npm link` → home cloned/created → `devcenter home <path>` → Claude Code hook in `~/.claude/settings.json` → Codex section in `~/.codex/AGENTS.md` → `devcenter ensure` inside a project prints its context line.
