import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { loadPlan, type PlanGraph } from "./planner-kernel";

/**
 * JOURNEY DOCUMENTATION, DRAWN FROM plan/.
 *
 * Three levels, top down: a JOURNEY enters at one interlocking and continues, through an artifact
 * the selected train produces, into the next; an INTERLOCKING chooses one route by its guards; a
 * ROUTE runs one TRAIN, a linear sequence of handovers. The page draws each journey as a map,
 * walks its nominal path end to end as one sequence, drills into every interlocking and train, and
 * tables what the plan leaves unconnected. It renders planned behaviour, not acceptance evidence.
 *
 * Output is deterministic (sorted, no timestamps, no package version) so `--check` can compare it
 * byte for byte, and SVG colours are `var(--atdd-*, fallback)` so a doc site can theme them.
 */

export type Step = { step: number; intent: string; from: string; to: string; artifact: string };
export type Train = { id: string; title: string; file: string; participants: string[]; sequence: Step[] };
export type Route = { id: string; category: string; priority: number; guardRef: string; guard?: string; trainId: string };
export type Interlocking = { id: string; title: string; file: string; exposed: boolean; actions: string[]; routes: Route[] };
type RouteRef = { interlocking: string; route: string };
export type Journey = {
  id: string; title: string; file: string; status: string; entry: string; exposed: boolean; actions: string[]; reason: string;
  continuations: Array<{ from: RouteRef; artifact: string; to: string }>; terminals: Array<{ from: RouteRef; outcome: string }>;
};
export type Gap = { kind: string; subject: string; detail: string };
export type JourneyModel = { journeys: Journey[]; interlockings: Map<string, Interlocking>; trains: Map<string, Train>; gaps: Gap[] };
export type PathLeg = { interlocking: string; route: Route; artifact?: string };
export type JourneyPath = { legs: PathLeg[]; end: { kind: "terminal"; outcome: string } | { kind: "loop"; to: string } | { kind: "open" } };

const str = (value: unknown) => typeof value === "string" ? value : "";
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
const rec = (value: unknown) => (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
const CATEGORY_ORDER = ["nominal", "alternate", "error", "exception"];
const categoryRank = (category: string) => { const i = CATEGORY_ORDER.indexOf(category); return i === -1 ? CATEGORY_ORDER.length : i; };

export function buildModel(graph: PlanGraph): JourneyModel {
  const trains = new Map<string, Train>(), interlockings = new Map<string, Interlocking>(), journeys: Journey[] = [], gaps: Gap[] = [];
  for (const artifact of graph.artifacts) {
    const d = artifact.data;
    if (artifact.kind === "train") trains.set(artifact.id, {
      id: artifact.id, title: str(d.title) || artifact.id, file: artifact.file,
      participants: Array.isArray(d.participants) ? d.participants.map(String) : [],
      sequence: list(d.sequence).map((s, i) => ({ step: Number(s.step) || i + 1, intent: str(s.intent), from: str(s.from), to: str(s.to), artifact: str(s.artifact) })),
    });
    if (artifact.kind === "interlocking") {
      const guards = new Map(list(d.fragments).flatMap(f => list(f.guards)).map(g => [str(g.id), str(g.expression)] as const));
      const entry = rec(d.entrypoint);
      interlockings.set(artifact.id, {
        id: artifact.id, title: str(d.title) || artifact.id, file: artifact.file, exposed: entry.exposed === true,
        actions: Array.isArray(entry.actions) ? entry.actions.map(String) : [],
        routes: list(d.routes).map(r => ({ id: str(r.route_id), category: str(r.category) || "nominal", priority: Number(r.priority) || 0, guardRef: str(r.guard_ref), guard: guards.get(str(r.guard_ref)) || undefined, trainId: str(r.train_id) }))
          .sort((a, b) => a.priority - b.priority || categoryRank(a.category) - categoryRank(b.category) || a.id.localeCompare(b.id)),
      });
    }
    if (artifact.kind === "journey") {
      const entry = rec(d.entrypoint), from = (value: unknown) => { const f = rec(rec(value).from); return { interlocking: str(f.interlocking_id), route: str(f.route_id) }; };
      journeys.push({
        id: artifact.id, title: str(d.title) || artifact.id, file: artifact.file, status: str(d.status), entry: str(entry.interlocking_id),
        exposed: entry.exposed === true, actions: Array.isArray(entry.actions) ? entry.actions.map(String) : [], reason: str(entry.reason),
        continuations: list(d.continuations).map(c => ({ from: from(c), artifact: str(c.artifact), to: str(rec(c.to).interlocking_id) })),
        terminals: list(d.terminals).map(t => ({ from: from(t), outcome: str(t.outcome) })),
      });
    }
  }
  journeys.sort(byId);
  // What the plan leaves unconnected. Each is a decision somebody has not made yet, so it is shown, never dropped.
  const reached = new Set<string>(), selected = new Set<string>();
  for (const journey of journeys) {
    if (!interlockings.has(journey.entry)) gaps.push({ kind: "unknown interlocking", subject: journey.id, detail: `enters at ${journey.entry}, which no interlocking declares` });
    for (const leg of reachable(journey, interlockings)) {
      reached.add(leg.interlocking);
      const accounted = journey.continuations.some(c => c.from.interlocking === leg.interlocking && c.from.route === leg.route.id) || journey.terminals.some(t => t.from.interlocking === leg.interlocking && t.from.route === leg.route.id);
      if (!accounted) gaps.push({ kind: "open route", subject: journey.id, detail: `${leg.interlocking} route ${leg.route.id} has no continuation and no terminal` });
    }
    if (!journey.exposed && !journey.reason) gaps.push({ kind: "unexplained internal journey", subject: journey.id, detail: "is not exposed and gives no reason" });
  }
  for (const il of [...interlockings.values()].sort(byId)) {
    if (!reached.has(il.id)) gaps.push({ kind: "unreached interlocking", subject: il.id, detail: journeys.length ? "no journey enters or continues into it" : "the plan declares no journey" });
    for (const route of il.routes) {
      if (trains.has(route.trainId)) selected.add(route.trainId); else gaps.push({ kind: "unknown train", subject: il.id, detail: `route ${route.id} runs ${route.trainId || "no train"}, which no train declares` });
      if (!route.guard) gaps.push({ kind: "unresolved guard", subject: il.id, detail: `route ${route.id} names guard ${route.guardRef || "(none)"}, which no fragment defines` });
    }
  }
  for (const train of [...trains.values()].sort(byId)) if (!selected.has(train.id)) gaps.push({ kind: "unrouted train", subject: train.id, detail: "no interlocking route selects it" });
  return { journeys, interlockings, trains, gaps };
}

/** Every (interlocking, route) a journey can reach from its entry, breadth first, once each. */
function reachable(journey: Journey, interlockings: Map<string, Interlocking>): Array<{ interlocking: string; route: Route }> {
  const out: Array<{ interlocking: string; route: Route }> = [], seen = new Set<string>(), queue = [journey.entry];
  while (queue.length) {
    const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id);
    for (const route of interlockings.get(id)?.routes ?? []) {
      out.push({ interlocking: id, route });
      for (const c of journey.continuations) if (c.from.interlocking === id && c.from.route === route.id) queue.push(c.to);
    }
  }
  return out;
}

/** Every path from the entry to an outcome. A path never revisits an interlocking; a loop is recorded as its end. */
export function journeyPaths(journey: Journey, model: JourneyModel, limit = 50): JourneyPath[] {
  const paths: JourneyPath[] = [];
  const walk = (id: string, legs: PathLeg[], visited: string[]) => {
    if (paths.length >= limit) return;
    const il = model.interlockings.get(id); if (!il || !il.routes.length) { paths.push({ legs, end: { kind: "open" } }); return; }
    for (const route of il.routes) {
      const next = journey.continuations.find(c => c.from.interlocking === id && c.from.route === route.id);
      const terminal = journey.terminals.find(t => t.from.interlocking === id && t.from.route === route.id);
      const leg = { interlocking: id, route, artifact: next?.artifact };
      if (next && visited.includes(next.to)) paths.push({ legs: [...legs, leg], end: { kind: "loop", to: next.to } });
      else if (next) walk(next.to, [...legs, leg], [...visited, next.to]);
      else paths.push({ legs: [...legs, leg], end: terminal ? { kind: "terminal", outcome: terminal.outcome } : { kind: "open" } });
    }
  };
  walk(journey.entry, [], [journey.entry]);
  return paths;
}

/** The path a journey takes when nothing goes wrong: the first route by category then priority at each interlocking. */
export function nominalPath(journey: Journey, model: JourneyModel): JourneyPath | undefined {
  const rank = (p: JourneyPath) => p.legs.map(l => String(categoryRank(l.route.category)).padStart(2, "0") + String(l.route.priority).padStart(4, "0")).join("|");
  return journeyPaths(journey, model).filter(p => p.end.kind === "terminal").sort((a, b) => rank(a).localeCompare(rank(b)))[0];
}

// ---- drawing ----------------------------------------------------------------------------------

/** Every colour is a themeable token with a light fallback, so a standalone SVG still reads. */
const C = {
  ink: "var(--atdd-ink, #1f2937)", ink2: "var(--atdd-ink-2, #475569)", ink3: "var(--atdd-ink-3, #64748b)", line: "var(--atdd-line, #cbd5e1)", paper: "var(--atdd-paper, #ffffff)",
  accent: "var(--atdd-accent, #0f766e)", wagon: "var(--atdd-wagon, #2563eb)", person: "var(--atdd-person, #b45309)", system: "var(--atdd-system, #7c3aed)",
  nominal: "var(--atdd-nominal, #15803d)", alternate: "var(--atdd-alternate, #2563eb)", error: "var(--atdd-error, #b91c1c)", exception: "var(--atdd-exception, #a16207)",
  terminal: "var(--atdd-terminal, #334155)", gap: "var(--atdd-gap, #dc2626)",
};
const SANS = "font-family: var(--atdd-sans, system-ui, sans-serif)", MONO = "font-family: var(--atdd-mono, ui-monospace, monospace)";
const categoryColor = (category: string) => (C as Record<string, string>)[category] ?? C.ink3;
export const partKind = (ref: string) => ref.startsWith("user:") ? "person" : ref.startsWith("system:") ? "system" : "wagon";
const partName = (ref: string) => ref.slice(ref.indexOf(":") + 1);
const kindColor = (ref: string) => C[partKind(ref) as "person" | "system" | "wagon"];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const slug = (id: string) => id.replace(/^[a-z]+:/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "unnamed";
const text = (x: number, y: number, s: string, style: string, anchor = "start") => `<text x="${x}" y="${y}" text-anchor="${anchor}" style="${style}">${esc(s)}</text>`;
function wrap(value: string, max: number): string[] {
  const out: string[] = []; let line = "";
  for (const word of value.split(/\s+/).filter(Boolean)) { if (line && line.length + 1 + word.length > max) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word; }
  return line ? [...out, line] : out.length ? out : [""];
}
const svg = (id: string, title: string, desc: string, w: number, h: number, body: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="atdd-diagram" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t-${id} d-${id}">\n<title id="t-${id}">${esc(title)}</title><desc id="d-${id}">${esc(desc)}</desc>\n${body.join("\n")}\n</svg>\n`;
const marker = (id: string, name: string, color: string) => `<marker id="${id}-${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" style="fill: ${color}"/></marker>`;

type SeqRow = { kind: "step"; step: Step; label: string } | { kind: "divider"; label: string; color: string };

/** A sequence diagram. Participants appear in order of first use, so a nominal path reads left to right. */
export function sequenceSvg(id: string, title: string, rows: SeqRow[]): string {
  const order: string[] = [];
  for (const r of rows) if (r.kind === "step") for (const p of [r.step.from, r.step.to]) if (p && !order.includes(p)) order.push(p);
  const GUT = 34, COL = 132, BOX_W = 118, BOX_H = 44, HEAD = 10, LINE_H = 13;
  const x = (ref: string) => GUT + COL / 2 + order.indexOf(ref) * COL, W = Math.max(GUT + COL * Math.max(order.length, 1) + 24, 360);
  const edges = { wagon: C.ink3, person: C.person, system: C.system };
  const edgeOf = (s: Step) => [s.from, s.to].some(p => partKind(p) === "system") ? "system" : [s.from, s.to].some(p => partKind(p) === "person") ? "person" : "wagon";
  const body: string[] = [`<defs>${Object.entries(edges).map(([k, c]) => marker(id, k, c)).join("")}</defs>`];
  let y = HEAD + BOX_H + 20;
  const laneTop = HEAD + BOX_H, drawn: string[] = [];
  for (const r of rows) {
    if (r.kind === "divider") {
      drawn.push(`<rect x="4" y="${y}" width="${W - 8}" height="22" rx="4" style="fill: ${C.paper}; stroke: ${r.color}; stroke-width: 1.2"/>`, text(14, y + 15, r.label, `${MONO}; font-size: 10px; fill: ${r.color}`));
      y += 36; continue;
    }
    const s = r.step, lines = wrap(s.intent, 58), x1 = x(s.from), x2 = x(s.to), color = edges[edgeOf(s)], arrowY = y + lines.length * LINE_H + 20;
    const labelX = Math.max(Math.min(x1, x2) - 4, GUT + 4);
    drawn.push(text(GUT - 14, arrowY + 4, r.label, `${MONO}; font-size: 9.5px; fill: ${C.ink3}`, "middle"));
    lines.forEach((l, i) => drawn.push(text(labelX, y + 10 + i * LINE_H, l, `${SANS}; font-size: 11px; fill: ${C.ink2}`)));
    drawn.push(text(labelX, y + 10 + lines.length * LINE_H, s.artifact, `${MONO}; font-size: 9px; fill: ${C.accent}`));
    if (s.from === s.to) drawn.push(`<circle cx="${x1}" cy="${arrowY}" r="3" style="fill: ${color}"/>`, `<path d="M ${x1} ${arrowY} h 32 v 18 h -26" style="fill: none; stroke: ${color}; stroke-width: 1.7" marker-end="url(#${id}-${edgeOf(s)})"/>`);
    else { const dir = x2 > x1 ? 1 : -1; drawn.push(`<circle cx="${x1}" cy="${arrowY}" r="3" style="fill: ${color}"/>`, `<line x1="${x1 + dir * 3}" y1="${arrowY}" x2="${x2 - dir * 5}" y2="${arrowY}" style="stroke: ${color}; stroke-width: 1.7" marker-end="url(#${id}-${edgeOf(s)})"/>`); }
    y = arrowY + (s.from === s.to ? 34 : 16);
  }
  const H = y + 8;
  for (const ref of order) {
    const cx = x(ref), color = kindColor(ref), names = partName(ref).length > 17 && partName(ref).includes("-") ? [partName(ref).slice(0, partName(ref).indexOf("-") + 1), partName(ref).slice(partName(ref).indexOf("-") + 1)] : [partName(ref)];
    body.push(`<line x1="${cx}" y1="${laneTop}" x2="${cx}" y2="${H - 6}" style="stroke: ${C.line}; stroke-width: 1.4; stroke-dasharray: 3 4"/>`,
      `<rect x="${cx - BOX_W / 2}" y="${HEAD}" width="${BOX_W}" height="${BOX_H}" rx="8" style="fill: ${C.paper}; stroke: ${color}; stroke-width: 1.8"/>`,
      ...names.map((n, i) => text(cx, HEAD + (names.length === 1 ? 22 : 17) + i * 11, n, `${SANS}; font-size: 10.5px; font-weight: 600; fill: ${C.ink}`, "middle")),
      text(cx, HEAD + 37, partKind(ref).toUpperCase(), `${MONO}; font-size: 8px; letter-spacing: .1em; fill: ${C.ink3}`, "middle"));
  }
  const desc = rows.map(r => r.kind === "step" ? `${r.label}. ${partName(r.step.from)} to ${partName(r.step.to)}, ${r.step.artifact}: ${r.step.intent}` : r.label).join(" ");
  return svg(id, title, desc, W, H, [...body, ...drawn]);
}

/** A journey as a map: entry, interlockings, the routes they choose, the trains they run, and where each leads. */
export function journeyMapSvg(journey: Journey, model: JourneyModel): string {
  type Node = { key: string; kind: "entry" | "interlocking" | "train" | "terminal" | "open"; label: string; sub: string; color: string; level: number; x?: number };
  const nodes = new Map<string, Node>(), edges: Array<{ from: string; to: string; label: string; color: string }> = [];
  const add = (node: Node) => { const existing = nodes.get(node.key); if (!existing) nodes.set(node.key, node); else existing.level = Math.min(existing.level, node.level); return node.key; };
  const entry = add({ key: "entry", kind: "entry", label: journey.actions.length ? journey.actions.join(", ") : journey.exposed ? "exposed" : "internal", sub: journey.exposed ? "STATION MASTER ACTION" : "INTERNAL ENTRY", color: C.ink2, level: 0 });
  const seen = new Set<string>(), queue: Array<[string, number]> = [[journey.entry, 1]];
  edges.push({ from: entry, to: `il:${journey.entry}`, label: "", color: C.ink3 });
  while (queue.length) {
    const [id, level] = queue.shift()!; if (seen.has(id)) continue; seen.add(id);
    const il = model.interlockings.get(id);
    add({ key: `il:${id}`, kind: "interlocking", label: il?.title ?? id, sub: il ? `INTERLOCKING · ${il.routes.length} ROUTE${il.routes.length === 1 ? "" : "S"}` : "UNDECLARED INTERLOCKING", color: il ? C.ink : C.gap, level });
    for (const route of il?.routes ?? []) {
      const train = model.trains.get(route.trainId), key = `route:${id}:${route.id}`;
      add({ key, kind: "train", label: train?.title ?? (route.trainId || "no train"), sub: `${route.category.toUpperCase()} · ${train ? `${train.sequence.length} STEPS` : "UNKNOWN TRAIN"}`, color: train ? categoryColor(route.category) : C.gap, level: level + 1 });
      edges.push({ from: `il:${id}`, to: key, label: route.guard ? `${route.id}: ${route.guard}` : route.id, color: categoryColor(route.category) });
      const next = journey.continuations.find(c => c.from.interlocking === id && c.from.route === route.id), terminal = journey.terminals.find(t => t.from.interlocking === id && t.from.route === route.id);
      if (next) { edges.push({ from: key, to: `il:${next.to}`, label: next.artifact, color: C.accent }); queue.push([next.to, level + 2]); }
      else if (terminal) edges.push({ from: key, to: add({ key: `end:${terminal.outcome}`, kind: "terminal", label: terminal.outcome, sub: "OUTCOME", color: C.terminal, level: level + 2 }), label: "", color: C.terminal });
      else edges.push({ from: key, to: add({ key: `open:${key}`, kind: "open", label: "no continuation", sub: "OPEN ROUTE", color: C.gap, level: level + 2 }), label: "", color: C.gap });
    }
  }
  const NODE_W = 200, NODE_H = 50, PITCH = 228, ROW = 122, PAD = 24, LOOP = 150;
  const levels = new Map<number, Node[]>();
  for (const node of nodes.values()) levels.set(node.level, [...(levels.get(node.level) ?? []), node]);
  // Order each row by where its parents sit, so an edge runs down to its own child instead of across the page.
  const slot = new Map<string, number>();
  for (const level of [...levels.keys()].sort((x, y) => x - y)) {
    const row = levels.get(level)!, parentAt = (n: Node) => { const xs = edges.filter(e => e.to === n.key && nodes.get(e.from)!.level < n.level).map(e => slot.get(e.from) ?? 0); return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0; };
    row.map((n, i) => ({ n, i, p: parentAt(n) })).sort((x, y) => x.p - y.p || x.i - y.i).forEach(({ n }, i) => { levels.get(level)![i] = n; slot.set(n.key, i - (row.length - 1) / 2); });
  }
  const widest = Math.max(...[...levels.values()].map(row => row.length)), hasLoop = edges.some(e => nodes.has(e.to) && nodes.get(e.to)!.level <= nodes.get(e.from)!.level);
  const W = Math.max(PAD * 2 + widest * PITCH + (hasLoop ? LOOP * 2 : 0), 420), H = PAD * 2 + (Math.max(...levels.keys()) + 1) * ROW - (ROW - NODE_H) + 14;
  const centre = hasLoop ? (W - LOOP * 2) / 2 : W / 2;
  for (const [, row] of levels) row.forEach((node, i) => { node.x = centre + (i - (row.length - 1) / 2) * PITCH; });
  const at = (key: string) => { const n = nodes.get(key)!; return { x: n.x!, y: PAD + 14 + n.level * ROW }; };
  const right = Math.max(...[...nodes.values()].map(n => n.x! + NODE_W / 2));
  const id = `map-${slug(journey.id)}`, body: string[] = [`<defs>${marker(id, "arrow", C.ink3)}</defs>`], labels: string[] = [];
  const incoming = new Map<string, number>();
  for (const e of edges) {
    if (!nodes.has(e.to)) continue;
    const a = at(e.from), b = at(e.to);
    if (b.y > a.y) {
      body.push(`<path d="M ${a.x} ${a.y + NODE_H} C ${a.x} ${a.y + NODE_H + 44}, ${b.x} ${b.y - 44}, ${b.x} ${b.y - 2}" style="fill: none; stroke: ${e.color}; stroke-width: 1.6" marker-end="url(#${id}-arrow)"/>`);
      // A label sits just above the node it leads to, never on the curve, where it would collide with siblings.
      if (e.label) { const n = incoming.get(e.to) ?? 0; incoming.set(e.to, n + 1); labels.push(text(b.x + 7, b.y - 9 - n * 12, wrap(e.label, 40)[0] + (wrap(e.label, 40).length > 1 ? " …" : ""), `${MONO}; font-size: 9px; fill: ${e.color}`, "start")); }
    } else {
      // A continuation back to an earlier (or the same) interlocking leaves to the right of every node,
      // climbs above the target's row, and enters it from the top, so it never seems to leave a neighbour.
      const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H / 2, out = right + LOOP * 0.45, top = b.y - 30, r = 10;
      body.push(`<path d="M ${x1} ${y1} H ${out - r} Q ${out} ${y1} ${out} ${y1 - r} V ${top + r} Q ${out} ${top} ${out - r} ${top} H ${b.x + NODE_W / 2 - 16 + r} Q ${b.x + NODE_W / 2 - 16} ${top} ${b.x + NODE_W / 2 - 16} ${top + r} V ${b.y - 2}" style="fill: none; stroke: ${e.color}; stroke-width: 1.6; stroke-dasharray: 5 3" marker-end="url(#${id}-arrow)"/>`);
      if (e.label) labels.push(text(out + 6, (y1 + top) / 2 + 3, e.label, `${MONO}; font-size: 9px; fill: ${e.color}`, "start"));
    }
  }
  for (const node of nodes.values()) {
    const { x, y } = at(node.key), left = x - NODE_W / 2, rx = node.kind === "entry" || node.kind === "terminal" || node.kind === "open" ? NODE_H / 2 : 6;
    body.push(`<rect x="${left}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="${rx}" style="fill: ${C.paper}; stroke: ${node.color}; stroke-width: ${node.kind === "interlocking" ? 2.2 : 1.6}${node.kind === "open" ? "; stroke-dasharray: 4 3" : ""}"/>`);
    if (node.kind === "interlocking") body.push(`<path d="M ${left + 14} ${y + NODE_H / 2} l 7 -7 l 7 7 l -7 7 z" style="fill: ${node.color}"/>`);
    const lines = wrap(node.label, node.kind === "interlocking" ? 26 : 30).slice(0, 2), tx = node.kind === "interlocking" ? x + 10 : x;
    lines.forEach((l, i) => body.push(text(tx, y + (lines.length === 1 ? 23 : 18) + i * 12, l, `${SANS}; font-size: 11px; font-weight: 600; fill: ${C.ink}`, "middle")));
    body.push(text(tx, y + NODE_H - 8, node.sub, `${MONO}; font-size: 8px; letter-spacing: .08em; fill: ${node.color}`, "middle"));
  }
  body.push(...labels);
  const desc = `Journey ${journey.title}: enters at ${journey.entry}; ${journey.continuations.length} continuation(s), ${journey.terminals.length} terminal outcome(s).`;
  return svg(id, `${journey.title} — journey map`, desc, Math.round(W), Math.round(H), body);
}

// ---- the page ---------------------------------------------------------------------------------

export const JOURNEY_DOCS_DIR = "docs/purpose/journeys";
export const GENERATED_MARK = "// Generated by @afokapu/atdd-bun from plan/. Do not edit; run `atdd-bun docs journeys`.";
const lit = (s: string) => `\`+${s.replaceAll("+", "{plus}")}+\``;
const cell = (s: string) => s.replaceAll("|", "\\|");

export function trainRows(train: Train): SeqRow[] { return train.sequence.map(step => ({ kind: "step" as const, step, label: String(step.step) })); }
export function pathRows(path: JourneyPath, model: JourneyModel): SeqRow[] {
  const rows: SeqRow[] = [];
  path.legs.forEach((leg, i) => {
    const il = model.interlockings.get(leg.interlocking), train = model.trains.get(leg.route.trainId);
    rows.push({ kind: "divider", label: `◇ ${il?.title ?? leg.interlocking} → ${leg.route.id} (${leg.route.category})${train ? ` → ${train.title}` : ""}`, color: categoryColor(leg.route.category) });
    for (const step of train?.sequence ?? []) rows.push({ kind: "step", step, label: `${i + 1}.${step.step}` });
  });
  const end = path.end;
  rows.push({ kind: "divider", label: end.kind === "terminal" ? `■ outcome: ${end.outcome}` : end.kind === "loop" ? `↺ continues back into ${end.to}` : "⚠ open: no continuation or terminal", color: end.kind === "open" ? C.gap : C.terminal });
  return rows;
}
const describePath = (path: JourneyPath, model: JourneyModel) => path.legs.map(l => `${model.interlockings.get(l.interlocking)?.title ?? l.interlocking} → ${l.route.id}`).join(" ⇒ ");
const describeEnd = (path: JourneyPath) => path.end.kind === "terminal" ? path.end.outcome : path.end.kind === "loop" ? `loops to ${path.end.to}` : "open";

/** Every file the journey documentation consists of, keyed by path relative to the output directory. */
export function renderJourneyDocs(model: JourneyModel, docId = "purpose.journeys"): Map<string, string> {
  const files = new Map<string, string>(), svgPath = (name: string) => `svg/${name}.svg`;
  const interlockings = [...model.interlockings.values()].sort(byId);
  const routeCount = interlockings.reduce((n, il) => n + il.routes.length, 0);
  const a: string[] = [
    "= Journeys", `:doc-id: ${docId}`, ":status: generated", ":toc: left", ":toclevels: 2", ":sectanchors:", "", GENERATED_MARK, "",
    "[.headline]", "The journeys this plan declares, the interlockings they pass through, and the trains those run, drawn from `plan/`. These are planned behaviour, not acceptance evidence.", "",
    "== Coverage", "", '[cols="1,1,1,1,1",options="header"]', "|===", "| Journeys | Interlockings reached | Routes | Trains | Gaps", "",
    `| ${model.journeys.length}`, `| ${interlockings.length - model.gaps.filter(g => g.kind === "unreached interlocking").length} of ${interlockings.length}`, `| ${routeCount}`, `| ${model.trains.size}`, `| ${model.gaps.length}`, "|===", "",
  ];
  a.push("== Gaps", "");
  if (!model.gaps.length) a.push("Every interlocking is reached by a journey, every reachable route ends in a continuation or an outcome, and every train is routed.", "");
  else a.push("What the plan leaves unconnected. Each row is a decision still to be made in `plan/`.", "", '[cols="1,2,3",options="header"]', "|===", "| Gap | Subject | Detail", "", ...model.gaps.flatMap(g => [`| ${g.kind}`, `| ${lit(g.subject)}`, `| ${cell(g.detail)}`, ""]), "|===", "");
  for (const journey of model.journeys) {
    const s = slug(journey.id), map = `journey-${s}`, paths = journeyPaths(journey, model), nominal = nominalPath(journey, model);
    files.set(svgPath(map), journeyMapSvg(journey, model));
    a.push(`== ${journey.title}`, "", `${lit(journey.id)} · ${journey.status || "no status"} · enters at ${lit(journey.entry)} · ${journey.exposed ? `exposed through ${journey.actions.map(lit).join(", ") || "no action"}` : `internal (${journey.reason || "no reason given"})`} · source ${lit(journey.file)}`, "",
      `image::${svgPath(map)}[${journey.title} journey map,opts=inline]`, "");
    if (nominal) {
      const walk = `path-${s}-nominal`;
      files.set(svgPath(walk), sequenceSvg(`walk-${s}`, `${journey.title} — nominal path`, pathRows(nominal, model)));
      a.push("=== Nominal path, end to end", "", `${describePath(nominal, model)} ⇒ *${describeEnd(nominal)}*`, "", `image::${svgPath(walk)}[${journey.title} nominal path,opts=inline]`, "");
    } else a.push("=== Nominal path, end to end", "", "No path from the entry reaches a terminal outcome.", "");
    a.push("=== Every path", "", '[cols="1,6,2",options="header"]', "|===", "| # | Interlocking → route, in order | Ends", "", ...paths.flatMap((p, i) => [`| ${i + 1}`, `| ${cell(describePath(p, model))}`, `| ${cell(describeEnd(p))}`, ""]), "|===", "");
  }
  a.push("== Interlockings and their trains", "");
  for (const il of interlockings) {
    a.push(`=== ${il.title}`, "", `${lit(il.id)} · ${il.exposed ? `exposed through ${il.actions.map(lit).join(", ") || "no action"}` : "internal"} · source ${lit(il.file)}`, "",
      '[cols="1,1,3,3",options="header"]', "|===", "| Priority | Category | Taken when | Runs", "",
      ...il.routes.flatMap(r => [`| ${r.priority}`, `| ${r.category}`, `| ${r.guard ? lit(r.guard) : `_unresolved ${lit(r.guardRef || "guard")}_`}`, `| ${lit(r.trainId)}`, ""]), "|===", "");
    for (const route of il.routes) {
      const train = model.trains.get(route.trainId); if (!train) continue;
      const name = `train-${slug(train.id)}`;
      if (!files.has(svgPath(name))) files.set(svgPath(name), sequenceSvg(`seq-${slug(train.id)}`, train.title, trainRows(train)));
      a.push(`==== ${route.id} (${route.category}): ${train.title}`, "", `image::${svgPath(name)}[${train.title},opts=inline]`, "");
    }
  }
  files.set("index.adoc", a.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n");
  return new Map([...files.entries()].sort(([x], [y]) => x.localeCompare(y)));
}

export type JourneyDocsResult = { ok: boolean; written: string[]; stale: string[]; message: string };

/** Whether the repository is in scope: it documents itself (docs/) and its plan has journeys or interlockings. */
export async function journeyDocsApply(root: string, graph?: PlanGraph) {
  if (!existsSync(join(root, "docs"))) return false;
  return (graph ?? await loadPlan(root)).artifacts.some(a => a.kind === "journey" || a.kind === "interlocking");
}

async function existing(dir: string): Promise<string[]> {
  if (!existsSync(join(dir, "svg"))) return [];
  return (await readdir(join(dir, "svg"))).filter(f => f.endsWith(".svg")).map(f => `svg/${f}`);
}

/** Write (or with `check`, compare) the journey documentation. Refuses to overwrite a hand-written index. */
export async function journeyDocs(options: { root?: string; out?: string; check?: boolean; force?: boolean } = {}): Promise<JourneyDocsResult> {
  const root = resolve(options.root ?? process.cwd()), dir = resolve(root, options.out ?? JOURNEY_DOCS_DIR), graph = await loadPlan(root);
  const expected = renderJourneyDocs(buildModel(graph)), rel = (f: string) => relative(root, join(dir, f)).replaceAll("\\", "/");
  const stale: string[] = [];
  for (const [file, content] of expected) { const path = join(dir, file); if (!existsSync(path) || await readFile(path, "utf8") !== content) stale.push(rel(file)); }
  const orphans = (await existing(dir)).filter(f => !expected.has(f));
  if (options.check) {
    const all = [...stale, ...orphans.map(rel)];
    return { ok: all.length === 0, written: [], stale: all, message: all.length ? `journey documentation is out of date with plan/: ${all.join(", ")}. Regenerate with \`atdd-bun docs journeys\` and commit the result.` : "journey documentation matches plan/" };
  }
  const index = join(dir, "index.adoc");
  if (existsSync(index) && !options.force && !(await readFile(index, "utf8")).includes(GENERATED_MARK)) return { ok: false, written: [], stale, message: `${rel("index.adoc")} exists and was not generated by atdd-bun; move it, choose --out, or pass --force to replace it` };
  for (const f of orphans) await rm(join(dir, f));
  for (const file of stale.map(s => relative(dir, join(root, s)).replaceAll("\\", "/"))) { await mkdir(dirname(join(dir, file)), { recursive: true }); await writeFile(join(dir, file), expected.get(file)!); }
  return { ok: true, written: stale, stale: [], message: stale.length || orphans.length ? `wrote ${stale.length} file(s), removed ${orphans.length} stale diagram(s) in ${relative(root, dir) || "."}` : "journey documentation already matches plan/" };
}
