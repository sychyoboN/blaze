import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForest, layoutTree, NODE_H, ROW_H, PAD } from "../scripts/map-view.mjs";

const tk = (id, parent = "") => ({ id, parent, status: "todo", updated: "2026-06-28" });

test("buildForest: flat orphans are all roots", () => {
  const f = buildForest([tk("A"), tk("B")]);
  assert.deepEqual(f.roots.map((t) => t.id), ["A", "B"]);
  assert.equal(f.childrenOf.size, 0);
  assert.equal(f.epicIds.size, 0);
});

test("buildForest: epic with two children", () => {
  const f = buildForest([tk("E"), tk("C1", "E"), tk("C2", "E")]);
  assert.deepEqual(f.roots.map((t) => t.id), ["E"]);
  assert.deepEqual(f.childrenOf.get("E").map((t) => t.id), ["C1", "C2"]);
  assert.ok(f.epicIds.has("E"));
  assert.equal(f.byId.get("E").id, "E");
  assert.equal(f.byId.size, 3);
});

test("buildForest: unresolvable or self parent becomes a root", () => {
  const f = buildForest([tk("A", "GHOST"), tk("B", "B")]);
  assert.deepEqual(f.roots.map((t) => t.id).sort(), ["A", "B"]);
});

test("layoutTree: single orphan sits at the origin pad", () => {
  const l = layoutTree(buildForest([tk("A")]));
  assert.equal(l.nodes.length, 1);
  assert.equal(l.nodes[0].x, PAD);
  assert.equal(l.nodes[0].y, PAD);
  assert.equal(l.standaloneY, null); // no epics -> no separator needed
});

test("layoutTree: standalone divider sits below epics and above orphans", () => {
  const l = layoutTree(buildForest([tk("E"), tk("c", "E"), tk("O")]));
  const by = Object.fromEntries(l.nodes.map((n) => [n.ticket.id, n]));
  assert.ok(l.standaloneY != null);
  assert.ok(l.standaloneY > by.E.y, "divider below the epic tree");
  assert.ok(by.O.y > l.standaloneY, "orphan below the divider");
});

test("layoutTree: parent centers on its two children", () => {
  const l = layoutTree(buildForest([tk("E"), tk("C1", "E"), tk("C2", "E")]));
  const by = Object.fromEntries(l.nodes.map((n) => [n.ticket.id, n]));
  assert.equal(by.C1.depth, 1);
  assert.equal(by.E.depth, 0);
  assert.equal(by.E.y, (by.C1.y + by.C2.y) / 2);
  assert.deepEqual(l.edges, [{ from: "E", to: "C1" }, { from: "E", to: "C2" }]);
  assert.equal(l.standaloneY, null); // no orphans
});

test("layoutTree: a second tree never overlaps the first", () => {
  const l = layoutTree(
    buildForest([tk("E1"), tk("a", "E1"), tk("E2"), tk("b", "E2")]),
  );
  const by = Object.fromEntries(l.nodes.map((n) => [n.ticket.id, n]));
  assert.ok(by.E2.y > by.a.y, "second epic starts below first epic's child");
});

test("layoutTree: a parent cycle still places every node once", () => {
  const l = layoutTree(buildForest([tk("A", "B"), tk("B", "A")]));
  assert.equal(l.nodes.length, 2);
  assert.deepEqual(l.nodes.map((n) => n.ticket.id).sort(), ["A", "B"]);
});
