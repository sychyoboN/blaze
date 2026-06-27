---
description: Sync the board to the code repo's git/PR state (mirror mode).
---

Run `npm run reconcile` to mirror the configured `codeRepo`'s branches and PRs onto
the board. In standalone mode (`codeRepo: null`) this is a no-op — tell the user to set
`codeRepo` in `blaze.config.json` if they expected moves.
