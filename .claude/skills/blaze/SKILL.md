---
name: blaze
description: Use when working in a Blaze board repo — creating, moving, or grooming tickets, or wiring the board to a code repo. Explains the directory-is-status model and the reconcile/groomer loops.
---

# Driving a Blaze board

Blaze is a file-based issue board: a ticket's status is the directory it sits in
(`backlog → todo → in-progress → in-review → done`, plus `canceled`/`duplicate`). The
full contract is in the repo's `AGENTS.md` — read it before acting.

- **Create:** `npm run new -- "Title"` (or `/blaze-new`). Move with `git mv` to change
  status.
- **Mirror a code repo:** set `codeRepo` + `key` in `blaze.config.json`; `npm run
  reconcile` (or `/blaze-reconcile`) drives `in-progress → in-review → done` from branch
  + PR state. The `<key>-<n>` in a branch name is the only link.
- **Groom:** `npm run groom` (or `/blaze-groom`) runs the agentic board-keeper over the
  backlog per `AGENTS.md` → "Grooming rules", auto-committing each change.
- **Run the app:** `npm start` boots the supervisor — the board, a live activity feed,
  and loop controls — at http://localhost:4321.

Never hand-move a ticket through the reconcile-owned columns; let reconcile do it.
