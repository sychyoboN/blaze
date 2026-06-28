// map-view.mjs — the Blaze Map view.
//
// Dual-runtime: this file is imported by node (serve.mjs + tests) for its pure
// functions and constants, AND served verbatim to the browser at
// /assets/map-view.js where initMap() runs. CONSTRAINT: no node-only API and no
// DOM access at module top level — DOM code lives only inside function bodies.

// Layout geometry (pixels). Shared by layoutTree (pure) and the DOM renderer.
export const NODE_W = 200;
export const NODE_H = 64;
export const H_GAP = 72;
export const ROW_H = 84;
export const PAD = 24;

const ACTIVE = new Set(["todo", "in-progress"]);

// ---- pure: forest construction -----------------------------------------

export function buildForest(tickets) {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const childrenOf = new Map();
  const roots = [];
  for (const t of tickets) {
    const p = t.parent;
    if (p && p !== t.id && byId.has(p)) {
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p).push(t);
    } else {
      roots.push(t);
    }
  }
  const epicIds = new Set(
    [...childrenOf.keys()].filter((id) => childrenOf.get(id).length > 0),
  );
  return { byId, childrenOf, roots, epicIds };
}
