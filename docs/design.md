# Blaze — design

**Date:** 2026-06-27
**Status:** approved (brainstorm), pre-implementation

## One-liner

Blaze is a file-based, git-native issue board that AI coding agents can drive.
Tickets are markdown files; a ticket's status is the folder it sits in. A reconcile
engine mirrors a code repo's git/PR state onto the board automatically. No app, no
database, no login — plain text, versioned in git, greppable.

It is a clean, generalized extraction of the private `carelia-tracker` tool. Blaze
ships generic and configurable; `carelia-tracker` stays exactly as it is and is not
touched by this work.

## Why it exists / the agent angle

The board is already the ideal shape for an AI coding agent to drive: it is plain
text and git, so an agent reads, writes, and moves tickets with the file tools it
already has — no API client, no auth, no SDK. Blaze leans into that with a universal
`AGENTS.md` describing the loop and a Claude Code plugin that makes it first-class
where the tool originated.

## Goals

- A generic, publishable OSS repo (MIT) that anyone can clone and use as either a
  standalone markdown kanban or a live mirror of their own code repo.
- Everything that was Carelia-specific (the `DEV` key, the `carelia-web` sibling path,
  the NDIS/shifts label taxonomy) becomes configuration, not hardcoded values.
- Preserve the original's character exactly: zero runtime dependencies, Node
  built-ins only, "the directory is the status" as the single rule.
- A documented, first-class way for AI agents to drive the board.

## Non-goals (YAGNI)

- No MCP server.
- No second git provider (GitLab/Forgejo) — GitHub via `gh` only, but with a clean
  `provider` seam so one can be added later.
- No web-based editing, no database, no auth. Files are the source of truth; anything
  that hides them behind an API is a different product.
- No migration of `carelia-tracker` onto Blaze, and no changes to `carelia-web`.
  carelia-web appears only as the README's worked example.

## Relationship to carelia-tracker (decided: clean extraction)

```
blaze/ (public, generic)              carelia-tracker/ (private, unchanged)
   key configurable                       DEV hardcoded
   codeRepo configurable        │         mirrors carelia-web as today
   published to GitHub          │         you keep using it as-is
        └────── no link, they diverge ──────┘
```

Blaze is built fresh from the *shape* of carelia-tracker (its scripts and docs are
the reference), not by mutating carelia-tracker in place. No private ticket history
enters the public repo.

## Two modes

This is the core generalization over the original, which assumed exactly one paired
repo.

1. **Standalone board** (`codeRepo: null`, the default) — a personal/team markdown
   kanban. You change status by hand: `git mv todo/TASK-008-*.md in-progress/`.
   `reconcile` is a no-op. This is the zero-config on-ramp for anyone not pairing the
   board 1:1 with a single repo.

2. **Mirror mode** (`codeRepo` set) — exactly the original behaviour. `reconcile`
   reads the code repo's branches + PRs and drives `in-progress → in-review → done`
   automatically. The manual columns (`backlog`, `todo`) stay the human's. The join
   key is the `<key>-<n>` embedded in every branch name / PR head ref — there is no
   API, webhook, or stored ID on the code side; the branch name *is* the link.

## Configuration — `blaze.config.json`

A single JSON file at the repo root holds everything that used to be hardcoded.
JSON is zero-dependency and equally editable by a human or an agent.

```json
{
  "key": "TASK",
  "boardTitle": "Blaze",
  "codeRepo": null,
  "provider": "github",
  "columns": ["backlog", "todo", "in-progress", "in-review", "done", "canceled", "duplicate"],
  "terminal": ["done", "canceled", "duplicate"],
  "defaultLabels": ["frontend", "backend", "infra", "docs", "bug", "chore"]
}
```

| Field | Meaning | Default |
|---|---|---|
| `key` | Ticket id prefix. `TASK-001`; branch `you/TASK-001-slug` | `"TASK"` |
| `boardTitle` | Dashboard heading + `<title>` | `"Blaze"` |
| `codeRepo` | Path to the repo to mirror; `null` = standalone | `null` |
| `provider` | Reconcile provider; only `github` implemented | `"github"` |
| `columns` | Lifecycle columns reconcile may move into | the seven shown |
| `terminal` | Sticky columns reconcile never drags a ticket back out of | `done/canceled/duplicate` |
| `defaultLabels` | Suggested label taxonomy (docs + scaffolder hint) | generic set |

A small `scripts/config.mjs` loads this file, applies defaults for any missing field,
and lets env vars override (e.g. `BLAZE_CODE_REPO`, `BLAZE_KEY`) — preserving the
original's `CARELIA_WEB_DIR` escape hatch in generic form.

## Repo layout

```
blaze/
├── README.md            # generic rewrite; keeps the "why this shape" section,
│                        #   drops NDIS/shifts examples, adds the agent pitch +
│                        #   the carelia-web-style mirror walkthrough as the example
├── AGENTS.md            # the universal agent loop (any agent reads this)
├── CONVENTIONS.md       # ticket shape + generic label taxonomy
├── TEMPLATE.md          # generic ticket template
├── LICENSE              # MIT
├── blaze.config.json    # the one config file
├── package.json         # bin: blaze; scripts: board / new / reconcile
├── .claude/
│   ├── skills/          # new-ticket, reconcile, board
│   └── commands/        # /blaze-new, /blaze-board, /blaze-reconcile
├── scripts/
│   ├── config.mjs       # NEW — loads blaze.config.json + env overrides
│   ├── new-ticket.sh    # generalized (key + padding from config)
│   ├── reconcile.mjs    # generalized (key + codeRepo + provider from config)
│   └── serve.mjs        # generalized (title + columns from config)
├── tests/               # NEW — node:test for the pure reconcile logic
├── docs/
│   └── design.md        # this file
└── backlog/ todo/ in-progress/ in-review/ done/ canceled/ duplicate/
                         # shipped empty except 1–2 example tickets
```

## Component behaviour & the generalization deltas

The three scripts keep their current logic; only the hardcoded values move to config.

### `scripts/config.mjs` (new)

Resolves the repo root, reads `blaze.config.json`, applies defaults, overlays env
overrides, and exports a frozen config object plus a couple of derived helpers — most
importantly the id regex `new RegExp("\\b" + key + "-(\\d+)", "i")` so both reconcile
and the scaffolder share one source of truth for the key.

### `scripts/reconcile.mjs`

Delta from the original:

- `WEB` (hardcoded `../carelia-web`) → `config.codeRepo` (absolute-resolved), with
  `BLAZE_CODE_REPO` override. If `codeRepo` is `null`, reconcile is a clean no-op that
  prints "standalone board — nothing to reconcile" and exits 0.
- `idFromRef` and the `^DEV-\d+.*\.md$` / `id: (DEV-\d+)` matchers → driven by
  `config.key`.
- `DIRS` / `TERMINAL` → `config.columns` / `config.terminal`.
- The `<user>/dev-<n>` vs `epic/...` branch-preference heuristic stays, but
  key-aware.
- **Refactor:** extract the pure decision — given `{ pr, branch }` for an id and the
  ticket's current column, return `{ target, branchVal, prVal, moved }` — into an
  exported function `decide(state, currentDir, config)`. This is what the new tests
  exercise. The file-moving/committing shell stays around it, unchanged in behaviour.
- GitHub via `gh` retained; the PR-gathering step is the one place a future
  `provider` switch would branch.

The state→column mapping is unchanged:

```
PR merged ............ done/
PR open .............. in-review/
PR closed (unmerged) . in-progress/   (canceled stays a manual decision)
branch, no PR ........ in-progress/
no branch, no PR ..... left where it is
```

Commit + push remain on by default with the same `--no-commit` / `--no-push` /
`--quiet` flags; the board server runs it on startup and every 60s.

### `scripts/new-ticket.sh`

Id prefix and zero-padding read from config (via a small `node scripts/config.mjs
--get key` style read, or by sourcing a generated value) instead of the literal
`DEV-%03d`. Slug logic, template patching, and "refuse to overwrite" are unchanged.

### `scripts/serve.mjs`

`<title>`, the `<h1>`, and the console line read `config.boardTitle`; the rendered
columns read `config.columns`. The reconcile-on-startup-and-every-60s loop calls the
generalized reconcile, which already self-disables in standalone mode. All HTML/CSS/JS
of the dashboard is otherwise unchanged.

## Agent-native layer

### `AGENTS.md` (universal)

The contract any agent reads before touching the board:

- The one rule: a ticket's status is the directory it sits in; there is no `status:`
  field, so it cannot drift.
- The loop: create in `backlog/` → human moves to `todo/` (intent) → from there
  reconcile drives `in-progress → in-review → done` from git state. Never hand-move a
  ticket through the reconcile-owned columns.
- The join key: branch names embed `<key>-<n>`; that is the only coupling to code.
- How to create a ticket, how to query the board with `ls`/`grep`, the frontmatter
  fields, and the standalone-vs-mirror distinction.

### `.claude/` plugin (Claude Code, first-class)

- **Skills:** `new-ticket` (scaffold), `reconcile` (sync), `board` (open/print the
  board) — thin wrappers over the scripts so a Claude Code user gets them without
  reading `AGENTS.md` first.
- **Commands:** `/blaze-new "title"`, `/blaze-board`, `/blaze-reconcile`.

## Testing

The original ships no tests. Blaze adds a `node:test` suite (built-in runner — keeps
the zero-dependency promise) covering:

- `decide(...)` — every row of the state→column table, plus the terminal-column
  stickiness and the idempotent "no git signal → leave it" case.
- `config.mjs` — defaults applied, env overrides win, key→regex derivation.
- `new-ticket` id/slug derivation — next-id = max+1, slug normalization, padding.

Run with `node --test`. No vitest, no deps.

## Docs, license, publishing

- **README** rewritten generic: keep the "why this shape" rationale, replace
  NDIS/shifts examples with neutral ones, add the agent pitch and the carelia-web
  mirror walkthrough as the worked example.
- **CONVENTIONS.md** label taxonomy genericized to `defaultLabels`.
- **LICENSE:** MIT.
- **Publishing:** ready to `gh repo create blaze --public --source . --push`. npm
  publish is optional and out of scope for v1 (clone-and-run); if ever done, the
  package name can be suffixed/scoped while the `blaze` command name is unaffected.

## Open questions

None blocking. Deferred by YAGNI: GitLab/Forgejo provider, MCP server, npm publish.
