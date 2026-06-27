import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashContent, loadState, saveState, selectNextTicket,
  extractGroomingRules, buildPrompt, parseChangedFiles, commitMessage,
} from "../scripts/loops/groomer.mjs";
import { loadConfig } from "../scripts/config.mjs";

function board() {
  const dir = mkdtempSync(join(tmpdir(), "blaze-groom-"));
  mkdirSync(join(dir, "backlog"), { recursive: true });
  writeFileSync(join(dir, "blaze.config.json"), JSON.stringify({ key: "TASK" }));
  return dir;
}

test("hashContent is deterministic", () => {
  assert.equal(hashContent("abc"), hashContent("abc"));
  assert.notEqual(hashContent("abc"), hashContent("abd"));
});

test("selectNextTicket returns the first ungroomed ticket, then null once recorded", () => {
  const dir = board();
  const cfg = loadConfig({ root: dir, env: {} });
  const raw = "---\nid: TASK-001\ntitle: x\n---\nbody\n";
  writeFileSync(join(dir, "backlog", "TASK-001-x.md"), raw);
  let state = { groomed: {} };
  const t = selectNextTicket(dir, cfg, state);
  assert.equal(t.id, "TASK-001");
  assert.equal(t.col, "backlog");
  state.groomed["TASK-001"] = hashContent(raw);
  assert.equal(selectNextTicket(dir, cfg, state), null);
  rmSync(dir, { recursive: true, force: true });
});

test("state round-trips through .blaze/state.json", () => {
  const dir = board();
  saveState(dir, { groomed: { "TASK-1": "deadbeef" } });
  assert.deepEqual(loadState(dir), { groomed: { "TASK-1": "deadbeef" } });
  rmSync(dir, { recursive: true, force: true });
});

test("extractGroomingRules slices the section", () => {
  const md = "# Title\n\n## The loop\nx\n\n## Grooming rules\n- set type\n- add labels\n\n## Querying\ny\n";
  const rules = extractGroomingRules(md);
  assert.match(rules, /## Grooming rules/);
  assert.match(rules, /add labels/);
  assert.doesNotMatch(rules, /Querying/);
});

test("buildPrompt names the target file, the rules, and the labels", () => {
  const dir = board();
  const cfg = loadConfig({ root: dir, env: {} });
  const ticket = { rel: "backlog/TASK-001-x.md", raw: "ticket body" };
  const p = buildPrompt(ticket, "## Grooming rules\n- set type", cfg);
  assert.match(p, /backlog\/TASK-001-x\.md/);
  assert.match(p, /Grooming rules/);
  assert.match(p, new RegExp(cfg.defaultLabels[0]));
  assert.match(p, /ticket body/);
  rmSync(dir, { recursive: true, force: true });
});

test("parseChangedFiles + commitMessage", () => {
  assert.deepEqual(parseChangedFiles("backlog/a.md\n\nbacklog/b.md\n"), ["backlog/a.md", "backlog/b.md"]);
  assert.equal(commitMessage("TASK-7", ["backlog/a.md"]), "chore(groom): TASK-7 1 file(s) groomed");
});

import { execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";

function gitBoard() {
  const dir = mkdtempSync(join(tmpdir(), "blaze-groom-e2e-"));
  mkdirSync(join(dir, "backlog"), { recursive: true });
  // A stub "agent": reads BLAZE_GROOM_TARGET, flips empty labels to [backend].
  const stub = join(dir, "stub-agent.sh");
  writeFileSync(stub, '#!/usr/bin/env bash\nsed -i -E "s/^labels: \\[\\]/labels: [backend]/" "$BLAZE_GROOM_TARGET"\n');
  chmodSync(stub, 0o755);
  writeFileSync(join(dir, "blaze.config.json"), JSON.stringify({
    key: "TASK",
    agentCommand: `bash ${stub}`,
    loops: { groomer: { columns: ["backlog"] } },
  }));
  writeFileSync(join(dir, "backlog", "TASK-001-x.md"),
    "---\nid: TASK-001\ntitle: x\ntype: feature\npriority: medium\nlabels: []\n---\nbody\n");
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "seed"]);
  return dir;
}

test("groomOnce drives the stub agent and auto-commits one chore(groom) change", async () => {
  const { groomOnce } = await import("../scripts/loops/groomer.mjs");
  const dir = gitBoard();
  const cfg = loadConfig({ root: dir, env: {} });
  const evt = groomOnce({ root: dir, cfg, agentsMd: "## Grooming rules\n- add labels\n", today: "2026-06-27" });
  assert.equal(evt.type, "groom");
  assert.equal(evt.id, "TASK-001");
  assert.ok(evt.sha, "expected a commit sha");
  const log = execFileSync("git", ["-C", dir, "log", "--oneline"], { encoding: "utf8" });
  assert.match(log, /chore\(groom\): TASK-001/);
  const body = readFileSync(join(dir, "backlog", "TASK-001-x.md"), "utf8");
  assert.match(body, /labels: \[backend\]/);
  // Idempotent: the same ticket is now recorded as groomed.
  assert.equal(groomOnce({ root: dir, cfg, agentsMd: "## Grooming rules\n", today: "2026-06-27" }), null);
  rmSync(dir, { recursive: true, force: true });
});
