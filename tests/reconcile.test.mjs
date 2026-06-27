import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../scripts/reconcile.mjs";

const cfg = { terminal: ["done", "canceled", "duplicate"] };

test("merged PR moves a ticket to done", () => {
  const d = decide({ pr: { state: "MERGED", number: 5, url: "u", headRefName: "you/TASK-5-x" } }, "in-review", cfg);
  assert.equal(d.target, "done");
  assert.equal(d.moved, true);
  assert.equal(d.prVal, "#5 — u");
  assert.equal(d.branchVal, "you/TASK-5-x");
});

test("open PR moves to in-review", () => {
  const d = decide({ pr: { state: "OPEN", number: 6, url: "u", headRefName: "b" } }, "todo", cfg);
  assert.equal(d.target, "in-review");
  assert.equal(d.moved, true);
});

test("closed (unmerged) PR moves to in-progress", () => {
  const d = decide({ pr: { state: "CLOSED", number: 7, url: "u", headRefName: "b" } }, "in-review", cfg);
  assert.equal(d.target, "in-progress");
});

test("branch with no PR moves to in-progress", () => {
  const d = decide({ branch: "you/TASK-8-y" }, "todo", cfg);
  assert.equal(d.target, "in-progress");
  assert.equal(d.branchVal, "you/TASK-8-y");
  assert.equal(d.prVal, null);
});

test("no git signal is skipped and left in place", () => {
  const d = decide({}, "backlog", cfg);
  assert.equal(d.skip, true);
  assert.equal(d.moved, false);
  assert.equal(d.target, "backlog");
});

test("terminal columns are sticky — a merged PR on a done ticket does not move it", () => {
  const d = decide({ pr: { state: "MERGED", number: 9, url: "u", headRefName: "b" } }, "done", cfg);
  assert.equal(d.target, "done");
  assert.equal(d.moved, false);
});

test("terminal stickiness also holds for a branch-only signal on a canceled ticket", () => {
  const d = decide({ branch: "b" }, "canceled", cfg);
  assert.equal(d.target, "canceled");
  assert.equal(d.moved, false);
});
