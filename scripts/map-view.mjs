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

// ---- pure: filtering ----------------------------------------------------

export function ticketMatches(t, { window, status, now }) {
  let windowOk = true;
  if (window != null) {
    const ms = Date.parse(t.updated);
    if (Number.isNaN(ms)) windowOk = false;
    else windowOk = (now - ms) / 86400000 <= window;
  }
  let statusOk = true;
  if (status === "active") statusOk = ACTIVE.has(t.status);
  else if (status === "inactive") statusOk = !ACTIVE.has(t.status);
  return windowOk && statusOk;
}

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

// ---- pure: tidy horizontal tree layout ---------------------------------

export function layoutTree(forest) {
  const { childrenOf, roots, byId } = forest;
  const nodes = [];
  const edges = [];
  const placed = new Set();
  let cursor = 0; // next free row slot
  let maxDepth = 0;

  function place(ticket, depth, standalone) {
    if (placed.has(ticket.id)) return null;
    placed.add(ticket.id);
    maxDepth = Math.max(maxDepth, depth);
    const kids = (childrenOf.get(ticket.id) || []).filter((k) => !placed.has(k.id));
    let y;
    if (kids.length === 0) {
      y = PAD + cursor * ROW_H;
      cursor += 1;
    } else {
      const childNodes = [];
      for (const k of kids) {
        const cn = place(k, depth + 1, false);
        if (cn) {
          childNodes.push(cn);
          edges.push({ from: ticket.id, to: k.id });
        }
      }
      if (childNodes.length) {
        y = (childNodes[0].y + childNodes[childNodes.length - 1].y) / 2;
      } else {
        y = PAD + cursor * ROW_H;
        cursor += 1;
      }
    }
    const node = {
      ticket,
      x: PAD + depth * (NODE_W + H_GAP),
      y,
      depth,
      standalone,
      contextOnly: false,
    };
    nodes.push(node);
    return node;
  }

  const hasKids = (r) => (childrenOf.get(r.id) || []).length > 0;
  const epics = roots.filter(hasKids);
  const orphans = roots.filter((r) => !hasKids(r));

  for (const r of epics) {
    place(r, 0, false);
    cursor += 1; // gap row between trees
  }

  let standaloneY = null;
  if (orphans.length) {
    if (epics.length > 0) {
      cursor += 1; // gap row after the epic trees
      standaloneY = PAD + cursor * ROW_H; // the "Standalone" divider row
      cursor += 1; // orphans sit below the divider
    }
    for (const r of orphans) place(r, 0, true);
  }

  // Completeness: anything left unplaced (a pure cycle) becomes its own root.
  for (const t of byId.values()) {
    if (!placed.has(t.id)) {
      place(t, 0, false);
    }
  }

  const width = PAD * 2 + (maxDepth + 1) * (NODE_W + H_GAP) - H_GAP;
  const height = PAD + cursor * ROW_H;
  return { nodes, edges, width, height, standaloneY };
}

// ---- pure: visibility (keep epic as context) ---------------------------

export function computeVisible(tickets, matchedIds) {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const visibleIds = new Set();
  const contextOnlyIds = new Set();
  for (const id of matchedIds) {
    visibleIds.add(id);
    let cur = byId.get(id);
    const guard = new Set([id]);
    while (cur && cur.parent && byId.has(cur.parent) && !guard.has(cur.parent)) {
      const pid = cur.parent;
      guard.add(pid);
      visibleIds.add(pid);
      if (!matchedIds.has(pid)) contextOnlyIds.add(pid);
      cur = byId.get(pid);
    }
  }
  return { visibleIds, contextOnlyIds };
}

// ---- browser: DOM render -----------------------------------------------

export const MAP_STYLES = `
  .mapview { display: flex; flex-direction: column; height: calc(100vh - 52px); }
  .map-tb { display: flex; gap: 18px; padding: 10px 20px; border-bottom: 1px solid #21262d; flex-wrap: wrap; }
  .map-tbgroup { display: flex; align-items: center; gap: 4px; }
  .map-tblabel { color: #7d8590; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; margin-right: 4px; }
  .map-pill { appearance: none; border: 1px solid #21262d; background: #161b22; color: #adbac7;
    font: inherit; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 6px; cursor: pointer; }
  .map-pill:hover { color: #fff; }
  .map-pill.on { color: #0F172A; background: var(--blaze-orange); border-color: var(--blaze-orange); }
  .map-body { position: relative; flex: 1; min-height: 0; display: flex; }
  .map-scroll { flex: 1; overflow: auto; position: relative; }
  .map-stage { position: relative; }
  .map-edges { position: absolute; inset: 0; pointer-events: none; }
  .map-edge { fill: none; stroke: #30363d; stroke-width: 1.5; }
  .map-divider { position: absolute; left: 0; height: 1px; border-top: 1px dashed #30363d;
    color: #7d8590; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; padding-left: ${PAD}px; }
  .map-node { position: absolute; box-sizing: border-box; min-height: ${NODE_H}px;
    background: #1c2128; border: 1px solid #2d333b; border-left: 3px solid #444c56;
    border-radius: 8px; padding: 7px 9px; cursor: pointer; overflow: hidden; }
  .map-node:hover { background: #20262e; }
  .map-node.sel { outline: 2px solid var(--blaze-orange); }
  .map-node.context { opacity: .45; }
  .map-node.prio-urgent { border-left-color: var(--blaze-red); }
  .map-node.prio-high { border-left-color: var(--blaze-orange); }
  .map-node.prio-medium { border-left-color: var(--blaze-amber); }
  .map-node.status-in-progress { background: #182634; }
  .map-node.status-todo { background: #1c2128; }
  .map-node.status-done, .map-node.status-canceled, .map-node.status-duplicate { background: #161b22; }
  .mn-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
  .mn-id { color: #7d8590; font-size: 10px; font-weight: 600; font-family: ui-monospace, monospace; }
  .mn-prio { font-size: 9px; padding: 0 5px; border-radius: 999px; text-transform: uppercase; }
  .mn-prio.prio-urgent { background: #4b1113; color: var(--blaze-red); }
  .mn-prio.prio-high { background: #4a2410; color: var(--blaze-orange); }
  .mn-prio.prio-medium { background: #4a3a0c; color: var(--blaze-amber); }
  .mn-prio.prio-low, .mn-prio.prio-none { background: #30363d; color: #7d8590; }
  .mn-title { margin-top: 2px; font-weight: 500; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mn-chips { margin-top: 4px; display: flex; gap: 3px; flex-wrap: nowrap; overflow: hidden; }
  .mn-type, .mn-label { font-size: 9px; padding: 0 5px; border-radius: 999px; white-space: nowrap; }
  .mn-type { background: #30363d; color: #adbac7; }
  .mn-label { background: #21314a; color: #79c0ff; }
  .mn-meta { margin-top: 4px; color: #7d8590; font-size: 10px; }
  .map-panel { width: 0; overflow: hidden; background: #161b22; border-left: 1px solid #21262d; transition: width .15s; }
  .map-panel.open { width: 340px; overflow: auto; }
  .map-panel > * { margin: 0 16px; }
  .mp-close { float: right; margin: 10px 12px 0 0; background: none; border: 0; color: #7d8590; font-size: 16px; cursor: pointer; }
  .mp-id { display: inline-block; margin-top: 14px; color: #7d8590; font-family: ui-monospace, monospace; font-size: 11px; }
  .mp-title { margin: 4px 16px 6px; font-size: 16px; }
  .mp-meta { color: #7d8590; font-size: 12px; margin-bottom: 10px; }
  .mp-pr { display: inline-block; margin: 0 16px 10px; color: #58a6ff; text-decoration: none; font-weight: 600; }
  .mp-body { color: #c9d1d9; font-size: 13px; padding-bottom: 24px; }
  .mp-body h4 { font-size: 12px; text-transform: uppercase; color: #adbac7; margin: 10px 0 4px; }
  .mp-body ul.md { padding-left: 18px; } .mp-body li.task { list-style: none; margin-left: -18px; }
  .mp-body code { background: #2d333b; padding: 1px 4px; border-radius: 4px; }
  .map-empty { color: #444c56; padding: 40px; text-align: center; }
`;

const SVG_NS = "http://www.w3.org/2000/svg";

export function initMap() {
  const dataEl = document.getElementById("blaze-map-data");
  const root = document.querySelector(".mapview");
  if (!dataEl || !root) return;
  const tickets = JSON.parse(dataEl.textContent);
  const scroll = root.querySelector(".map-scroll");
  const panel = root.querySelector(".map-panel");

  const ls = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const setLs = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  const filters = {
    window: ls("tracker.map.window", "all"),
    status: ls("tracker.map.status", "all"),
  };

  function syncToolbar() {
    root.querySelectorAll(".map-tb [data-filter]").forEach((b) =>
      b.classList.toggle("on", filters[b.dataset.filter] === b.dataset.value));
  }

  root.querySelectorAll(".map-tb [data-filter]").forEach((b) =>
    b.addEventListener("click", () => {
      filters[b.dataset.filter] = b.dataset.value;
      setLs("tracker.map." + b.dataset.filter, b.dataset.value);
      syncToolbar();
      render();
    }));

  function render() {
    const now = Date.now();
    const win = filters.window === "all" ? null : Number(filters.window);
    const matchedIds = new Set(
      tickets
        .filter((t) => ticketMatches(t, { window: win, status: filters.status, now }))
        .map((t) => t.id));
    const { visibleIds, contextOnlyIds } = computeVisible(tickets, matchedIds);
    const visible = tickets.filter((t) => visibleIds.has(t.id));
    scroll.innerHTML = "";
    if (!visible.length) {
      scroll.innerHTML = '<div class="map-empty">No tickets match these filters.</div>';
      return;
    }
    const layout = layoutTree(buildForest(visible));
    layout.nodes.forEach((n) => { n.contextOnly = contextOnlyIds.has(n.ticket.id); });
    drawMap(scroll, layout, (t, el) => selectNode(panel, el, t));
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(panel); });
  scroll.addEventListener("click", (e) => {
    if (e.target === scroll || e.target.classList.contains("map-stage")) closePanel(panel);
  });

  syncToolbar();
  render();
}

function drawMap(scroll, layout, onSelect) {
  const stage = document.createElement("div");
  stage.className = "map-stage";
  stage.style.width = layout.width + "px";
  stage.style.height = layout.height + "px";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "map-edges");
  svg.setAttribute("width", layout.width);
  svg.setAttribute("height", layout.height);
  const pos = new Map(layout.nodes.map((n) => [n.ticket.id, n]));
  for (const e of layout.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
    const x2 = b.x, y2 = b.y + NODE_H / 2;
    const midX = x1 + H_GAP / 2;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`);
    path.setAttribute("class", "map-edge");
    svg.appendChild(path);
  }
  stage.appendChild(svg);

  if (layout.standaloneY != null) {
    const div = document.createElement("div");
    div.className = "map-divider";
    div.style.top = layout.standaloneY + "px";
    div.style.width = layout.width + "px";
    div.textContent = "Standalone";
    stage.appendChild(div);
  }

  for (const n of layout.nodes) stage.appendChild(nodeEl(n, onSelect));
  scroll.appendChild(stage);
}

function nodeEl(n, onSelect) {
  const t = n.ticket;
  const el = document.createElement("div");
  el.className =
    `map-node prio-${t.priority || "none"} status-${t.status}` +
    (n.contextOnly ? " context" : "");
  el.style.left = n.x + "px";
  el.style.top = n.y + "px";
  el.style.width = NODE_W + "px";

  const top = document.createElement("div");
  top.className = "mn-top";
  const id = document.createElement("span"); id.className = "mn-id"; id.textContent = t.id;
  const prio = document.createElement("span");
  prio.className = "mn-prio prio-" + (t.priority || "none");
  prio.textContent = t.priority || "none";
  top.append(id, prio);

  const title = document.createElement("div");
  title.className = "mn-title"; title.textContent = t.title;
  el.append(top, title);

  if (!n.contextOnly) {
    const chips = [];
    if (t.type) chips.push(["mn-type", t.type]);
    (t.labels || []).forEach((l) => chips.push(["mn-label", l]));
    if (chips.length) {
      const row = document.createElement("div"); row.className = "mn-chips";
      for (const [cls, txt] of chips) {
        const s = document.createElement("span"); s.className = cls; s.textContent = txt;
        row.appendChild(s);
      }
      el.appendChild(row);
    }
    const bits = [];
    if (t.assignee && t.assignee !== "unassigned") bits.push("@" + t.assignee);
    if (t.estimate) bits.push(t.estimate + " pts");
    if (bits.length) {
      const m = document.createElement("div"); m.className = "mn-meta"; m.textContent = bits.join(" · ");
      el.appendChild(m);
    }
  }

  el.addEventListener("click", (ev) => { ev.stopPropagation(); onSelect(t, el); });
  return el;
}

function selectNode(panel, el, t) {
  document.querySelectorAll(".map-node.sel").forEach((x) => x.classList.remove("sel"));
  el.classList.add("sel");
  openPanel(panel, t);
}

function openPanel(panel, t) {
  panel.innerHTML = "";
  const close = document.createElement("button");
  close.className = "mp-close"; close.textContent = "✕";
  close.addEventListener("click", () => closePanel(panel));
  const id = document.createElement("div"); id.className = "mp-id"; id.textContent = t.id;
  const title = document.createElement("h2"); title.className = "mp-title"; title.textContent = t.title;
  const meta = document.createElement("div"); meta.className = "mp-meta";
  const bits = [];
  if (t.assignee && t.assignee !== "unassigned") bits.push("@" + t.assignee);
  if (t.estimate) bits.push(t.estimate + " pts");
  if (t.parent) bits.push("↳ " + t.parent);
  if (t.project) bits.push(t.project);
  bits.push(t.status);
  meta.textContent = bits.join(" · ");
  panel.append(close, id, title, meta);
  const prUrl = (String(t.pr || "").match(/https?:\/\/\S+/) || [])[0];
  if (prUrl) {
    const a = document.createElement("a");
    a.className = "mp-pr"; a.href = prUrl; a.target = "_blank"; a.rel = "noopener"; a.textContent = "🔗 PR";
    panel.appendChild(a);
  }
  const body = document.createElement("div"); body.className = "mp-body";
  body.innerHTML = t.bodyHtml || ""; // server-rendered + escaped by serve.mjs mdLite()
  panel.appendChild(body);
  panel.classList.add("open");
}

function closePanel(panel) {
  panel.classList.remove("open");
  document.querySelectorAll(".map-node.sel").forEach((x) => x.classList.remove("sel"));
}
