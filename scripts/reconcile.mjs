#!/usr/bin/env node
// reconcile.mjs — make the board mirror the configured code repo's git/PR state.
//
//   node scripts/reconcile.mjs             # sync once, commit + push the moves (default)
//   node scripts/reconcile.mjs --no-push   # commit the moves but don't push
//   node scripts/reconcile.mjs --no-commit # move files only; leave them uncommitted
//   node scripts/reconcile.mjs --quiet     # only print on change (used by the board timer)
//
// Commit + push are ON by default: a reconcile that moved tickets but left the
// change dangling is the manual cleanup this tool exists to prevent.
//
// Git is the source of truth; the board is a live mirror. The join key is the
// <KEY>-<n> embedded in every branch name / PR head ref. A ticket with NO branch
// and NO PR is never touched — manual backlog/todo placement (and chores marked
// done without a PR) are left exactly as you wrote them.
//
//   PR merged ............ done/
//   PR open .............. in-review/
//   PR closed (unmerged) . in-progress/   (canceled stays a manual decision)
//   branch, no PR ........ in-progress/
//   no branch, no PR ..... left where it is
//
// In STANDALONE mode (codeRepo: null in blaze.config.json) reconcile is a clean
// no-op — it prints a message and exits 0.
//
// Zero dependencies — Node built-ins + shelling out to `git` and `gh`.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Delta 1: load config; derive WEB/DIRS/TERMINAL from it.
import { loadConfig } from "./config.mjs";

const cfg = loadConfig();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = cfg.codeRepoPath;
const DIRS = cfg.columns;
const TERMINAL = new Set(cfg.terminal);

// --- small shell helper: returns trimmed stdout, or null on any failure -----
function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

// Delta 2: local idFromRef deleted — use cfg.idFromRef everywhere.

// --- gather git state from the configured code repo -------------------------
function gather({ fetch }) {
  // Delta 3: null codeRepoPath → clean standalone short-circuit.
  if (!WEB) return { ok: true, standalone: true, prMap: new Map(), branchMap: new Map() };
  if (!existsSync(WEB) || !existsSync(join(WEB, ".git"))) {
    return { ok: false, error: `code repo not found at ${WEB} (set codeRepo / BLAZE_CODE_REPO)` };
  }
  if (fetch) sh("git", ["-C", WEB, "fetch", "--prune", "--quiet"], { timeout: 30000 });

  // PRs: one gh call, newest-wins, ranked merged > open > closed.
  const prMap = new Map();
  const rank = { MERGED: 3, OPEN: 2, CLOSED: 1 };
  const prJson = sh("gh", ["pr", "list", "--state", "all", "--limit", "1000",
    "--json", "number,url,headRefName,state"], { cwd: WEB });
  if (prJson === null) {
    return { ok: false, error: "`gh pr list` failed (is gh installed & authed? run `gh auth login`)" };
  }
  for (const pr of JSON.parse(prJson || "[]")) {
    // Delta 2: cfg.idFromRef instead of local idFromRef.
    const id = cfg.idFromRef(pr.headRefName);
    if (!id) continue;
    const cur = prMap.get(id);
    const better = !cur ||
      (rank[pr.state] || 0) > (rank[cur.state] || 0) ||
      ((rank[pr.state] || 0) === (rank[cur.state] || 0) && pr.number > cur.number);
    if (better) prMap.set(id, pr);
  }

  // Branches (local + origin) → id -> branch name, preferring a feature branch.
  const branchMap = new Map();
  const refs = sh("git", ["-C", WEB, "for-each-ref", "--format=%(refname:short)",
    "refs/heads", "refs/remotes/origin"]) || "";
  for (let ref of refs.split("\n")) {
    ref = ref.replace(/^origin\//, "").trim();
    if (!ref || ref === "HEAD") continue;
    // Delta 2: cfg.idFromRef instead of local idFromRef.
    const id = cfg.idFromRef(ref);
    if (!id) continue;
    const existing = branchMap.get(id);
    // Delta 3: key-based feature branch heuristic (was hardcoded /dev-\d+/).
    const feat = new RegExp(`/${cfg.key}-\\d+`, "i");
    if (!existing || (feat.test(ref) && !feat.test(existing))) branchMap.set(id, ref);
  }

  return { ok: true, prMap, branchMap };
}

// --- frontmatter helpers ----------------------------------------------------
// Delta 5: use cfg.idLineRegex instead of a hardcoded /^id:\s*(DEV-\d+)/m.
function parseId(raw) {
  const m = cfg.idLineRegex.exec(raw);
  return m ? m[1] : null;
}
function fieldValue(fm, key) {
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(fm);
  return m ? m[1].trim() : null;
}
// Returns the rewritten file, or null if no field actually changed.
function applyFields(raw, fields, bumpUpdated, today) {
  const m = /^(---\n)([\s\S]*?)(\n---\r?\n?)([\s\S]*)$/.exec(raw);
  if (!m) return null;
  let lines = m[2].split("\n");
  let changed = false;

  const setField = (key, value) => {
    const idx = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
    const line = `${key}: ${value}`;
    if (idx === -1) {
      // insert after `branch:` if present, else before `created:`, else append
      let at = lines.findIndex((l) => /^branch:/.test(l));
      if (at !== -1) at += 1;
      else { at = lines.findIndex((l) => /^created:/.test(l)); if (at === -1) at = lines.length; }
      lines.splice(at, 0, line);
      changed = true;
    } else if (lines[idx] !== line) {
      lines[idx] = line;
      changed = true;
    }
  };

  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    setField(k, v);
  }
  if (bumpUpdated) setField("updated", today);

  if (!changed) return null;
  return m[1] + lines.join("\n") + m[3] + m[4];
}

// Delta 6: exported pure decision function — no I/O.
// Given the git signal for a ticket and its current column, return the target
// column + the branch/pr metadata to write.
export function decide({ pr, branch }, currentDir, cfg) {
  let target, branchVal = null, prVal = null;
  if (pr) {
    target = pr.state === "MERGED" ? "done" : pr.state === "OPEN" ? "in-review" : "in-progress";
    branchVal = pr.headRefName;
    prVal = `#${pr.number} — ${pr.url}`;
  } else if (branch) {
    target = "in-progress";
    branchVal = branch;
  } else {
    return { target: currentDir, branchVal: null, prVal: null, moved: false, skip: true };
  }
  if (cfg.terminal.includes(currentDir)) target = currentDir;
  return { target, branchVal, prVal, moved: target !== currentDir, skip: false };
}

// --- the reconcile pass -----------------------------------------------------
export function reconcile({ fetch = false, commit = false, push = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const state = gather({ fetch });
  if (!state.ok) return { ok: false, error: state.error, changes: [] };
  // Delta 4: standalone short-circuit — codeRepo is null, nothing to mirror.
  if (state.standalone) return { ok: true, standalone: true, changes: [] };
  const { prMap, branchMap } = state;

  const changes = [];
  for (const dir of DIRS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const file of readdirSync(abs)) {
      // Delta 5: cfg.fileRegex instead of hardcoded /^DEV-\d+.*\.md$/.
      if (!cfg.fileRegex.test(file)) continue;
      const path = join(abs, file);
      const raw = readFileSync(path, "utf8");
      const id = parseId(raw);
      if (!id) continue;

      // Delta 6: call decide() instead of inline target/branchVal/prVal logic.
      const d = decide({ pr: prMap.get(id), branch: branchMap.get(id) }, dir, cfg);
      if (d.skip) continue;
      const { target, branchVal, prVal, moved } = d;

      // Terminal columns are sticky: keep the ticket here, just refresh metadata.
      // (decide() already handles stickiness; target === dir when sticky.)

      const fm = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1] || "";
      const fields = {};
      if (branchVal && fieldValue(fm, "branch") !== branchVal) fields.branch = branchVal;
      if (prVal && fieldValue(fm, "pr") !== prVal) fields.pr = prVal;

      // updated: only bumps on an actual status (folder) change, not on enrichment.
      const newRaw = applyFields(raw, fields, moved, today);
      if (!moved && !newRaw) continue; // fully idempotent — nothing to do

      const finalRaw = newRaw ?? raw;
      const destDir = moved ? join(ROOT, target) : abs;
      const destPath = join(destDir, file);
      if (newRaw) writeFileSync(path, finalRaw);
      if (moved) renameSync(path, destPath);

      const pr = prMap.get(id);
      changes.push({ id, from: dir, to: target, moved, pr: pr ? pr.number : null });
    }
  }

  let committed = false;
  if (commit && changes.length) {
    sh("git", ["-C", ROOT, "add", "-A"]);
    committed = sh("git", ["-C", ROOT, "commit", "-m",
      `chore(board): reconcile ${changes.length} ticket(s) to git state`]) !== null;
    // Keep the remote board in sync so no manual cleanup is ever needed.
    // Tolerant: a push failure (offline, no upstream) is warned, not fatal.
    if (committed && push && sh("git", ["-C", ROOT, "push"]) === null) {
      console.warn("reconcile: committed locally but `git push` failed — push manually when back online.");
    }
  }

  return { ok: true, changes, committed };
}

// --- CLI --------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const quiet = args.includes("--quiet");
  // Commit + push are the default: a reconcile that moved tickets but left the
  // change uncommitted is exactly the manual cleanup we want to eliminate.
  // Opt out with --no-commit (also skips push) or --no-push (commit only).
  const r = reconcile({
    fetch: !args.includes("--no-fetch"),
    commit: !args.includes("--no-commit"),
    push: !args.includes("--no-push"),
  });
  if (!r.ok) {
    console.error(`reconcile: ${r.error}`);
    process.exit(1);
  }
  // Delta 7: standalone board message.
  if (r.standalone) { if (!quiet) console.log("reconcile: standalone board — nothing to reconcile."); return; }
  if (!r.changes.length) {
    if (!quiet) console.log("reconcile: already in sync — nothing to do.");
    return;
  }
  for (const c of r.changes) {
    const tag = c.moved ? `${c.from} → ${c.to}` : `${c.to} (metadata)`;
    console.log(`  ${c.id}: ${tag}${c.pr ? ` (PR #${c.pr})` : ""}`);
  }
  console.log(`reconcile: ${r.changes.length} ticket(s) updated.`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
