// Shared helpers for the bun_interlocking_coverage FAMILY detector.
// Bun/TS realization of the core python `interlocking_coverage.py` detector (core
// afokapu/atdd#1248 route space + #1251 runner call model). Each check under ../checks/*.mjs imports
// this module and scans a consumer tree for ONE tester.bun.interlocking-* rule.
//
// ZERO third-party deps — node builtins only. The interlocking route space is stack-neutral planner
// data (snake_case, plan/_trains/_interlockings/**); the e2e tests are Bun/TS under e2e/**.

import { excludedPath } from "../../../lib/scan.mjs";
import { readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

export const DEFAULT_EXCLUDES = ["_generated", "node_modules", "dist", "build", ".next"];
export const PLAN_ROOT = process.env.ATDD_PLAN_ROOT || "plan";

// Production runner symbols (core #1251 call model).
export const PROD_INTERLOCKING = "InterlockingRunner";
export const PROD_TRAIN = "TrainRunner";

// Required trace-binding fields, TS camelCase, transcribed from core's own
// InterlockingResolution.as_trace() (src/atdd/runtime/interlocking/runner.py).
//
// No routeCategoryDigit: core retired the digit (#1421 / #1440) and its own test notes the trace
// field "no longer means anything". The /\brouteCategory\b/ boundary still earns its keep — in
// camelCase a trailing "Digit" defeats it, so a LEGACY consumer emitting only routeCategoryDigit
// is still reported as missing routeCategory rather than silently passing on the dead field.
export const REQUIRED_TRACE_FIELDS = [
  ["interlockingId", /\binterlockingId\b/],
  ["routeId", /\brouteId\b/],
  ["selectedTrainId", /\bselectedTrainId\b/],
  ["routeCategory", /\brouteCategory\b/],
  ["guardId", /\bguardId\b/],
  ["resolutionStrategy", /\bresolutionStrategy\b/],
  ["resolutionReason", /\bresolutionReason\b/],
];

// Forbidden runner-substitution patterns (production-runner-used), Bun/vitest idioms.
export const FORBIDDEN_PATTERNS = [
  ["MockInterlockingRunner", /\bMockInterlockingRunner\b/],
  ["MockTrainRunner", /\bMockTrainRunner\b/],
  // BUN'S OWN SUBSTITUTION SURFACE, and the reason it is listed FIRST.
  //
  // This list arrived from the Convex mirror carrying only `vi.`/`jest.`-prefixed
  // idioms. On Bun that under-fires on exactly the stack the rule governs: `bun:test`
  // exposes bare `mock()` and `spyOn()`, plus `mock.module()` — the most powerful of
  // the three and the one a Bun developer actually reaches for. A test that swapped the
  // whole InterlockingRunner module through `mock.module()` while still importing both
  // production symbols reported CLEAN, which is precisely the descriptive green this
  // rule exists to catch. The vocabulary below is the same one
  // `tester.bun.smoke-no-collaborator-substitution` already pins
  // (bun_tester_discipline_detector/checks/t_smoke_no_substitution.mjs), so the two
  // tester rules now agree about what substitution means on this stack.
  [
    "mock.module() replacing a runner module",
    /\bmock\s*\.\s*module\s*\(/,
  ],
  [
    "spyOn() replacing runner behavior",
    /\bspyOn\s*\(\s*[^)]*(?:InterlockingRunner|TrainRunner|[Rr]unner|resolveTrain|execute)/,
  ],
  [
    "mock() standing in for a runner",
    /\b(?:const|let|var)\s+\w*(?:[Rr]unner|[Ii]nterlocking|[Tt]rain)\w*\s*=\s*mock\s*\(/,
  ],
  [
    "mock.restore() around runner execution",
    /\bmock\s*\.\s*restore\s*\(/,
  ],
  [
    "vi.mock()/jest.mock() around a runner module",
    /\b(?:vi|jest)\s*\.\s*mock\s*\(\s*[^)]*(?:interlocking|InterlockingRunner|TrainRunner|runner)/,
  ],
  [
    "vi.spyOn()/jest.spyOn() replacing runner behavior",
    /\b(?:vi|jest)\s*\.\s*spyOn\s*\(\s*[^)]*(?:InterlockingRunner|TrainRunner|resolveTrain|execute)/,
  ],
  [
    "hand-built route resolver replacing InterlockingRunner",
    /(?:^|\n)\s*(?:(?:async\s+)?function\s+resolveTrain|class\s+\w*Resolver)\b/,
  ],
];

// REACHING THE STATION MASTER, detected STRUCTURALLY rather than by naming.
//
// This was the name alone, which required a consumer's smoke test to contain a symbol
// literally called StationMaster. Nothing asks for that. The coder rule defines the
// Station Master as `server.ts` carrying a JOURNEY_MAP — structure, not nomenclature —
// and the coder detector matches it that way, so a consumer whose entrypoint is a
// module-level dispatch PASSED the coder rule and FAILED this one, with no documented
// way to satisfy both. It only ever worked because the fixtures happen to export a
// class with that name. (This provider already contradicted itself: the train
// composition detector accepts an `app.*` FILE while this one demanded the SYMBOL.)
//
// Found by running the python sibling against a real consumer repo rather than against
// its own fixtures; the same defect was mirrored into every JS realization.
export const STATION_MASTER =
  /\b(?:StationMaster|station_master|stationMaster)\b|\bJOURNEY_MAP\b|^\s*import\b[^\n]*\bserver\b|\bserver\.[A-Za-z_]/m;
export const TRACE_OBJECT = /\btrace\b/;

export function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function readText(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

// Blank `//` and `/* */` comments to spaces (offsets/newlines preserved); keep string literals so a
// routeId/trainId token inside a `.toBe("...")` literal and a `trace.routeId` identifier still match,
// but a route/field name that only appears in a comment does NOT count as coverage/an assertion.
export function maskComments(text) {
  const out = text.split("");
  const n = text.length;
  let i = 0;
  let state = "code";
  while (i < n) {
    const c = text[i];
    const d = i + 1 < n ? text[i + 1] : "";
    if (state === "code") {
      if (c === "/" && d === "/") { out[i] = out[i + 1] = " "; i += 2; state = "line"; continue; }
      if (c === "/" && d === "*") { out[i] = out[i + 1] = " "; i += 2; state = "block"; continue; }
      if (c === "'") { i++; state = "sq"; continue; }
      if (c === '"') { i++; state = "dq"; continue; }
      if (c === "`") { i++; state = "tpl"; continue; }
      i++;
      continue;
    }
    if (state === "line") { if (c === "\n") state = "code"; else out[i] = " "; i++; continue; }
    if (state === "block") { if (c === "*" && d === "/") { out[i] = out[i + 1] = " "; i += 2; state = "code"; continue; } if (c !== "\n") out[i] = " "; i++; continue; }
    if (state === "sq" || state === "dq") { const q = state === "sq" ? "'" : '"'; if (c === "\\") { i += 2; continue; } if (c === q) state = "code"; i++; continue; }
    if (c === "\\") { i += 2; continue; }
    if (c === "`") { state = "code"; i++; continue; }
    i++;
  }
  return out.join("");
}

export function lineOfIndex(text, idx) {
  return text.slice(0, idx).split("\n").length;
}

export function lineAt(text, lineno) {
  const lines = text.split(/\r?\n/);
  return lineno >= 1 && lineno <= lines.length ? lines[lineno - 1].trim() : "";
}

export function rel(path, root) {
  const r = root.endsWith(sep) ? root : root + sep;
  return path.startsWith(r) ? path.slice(r.length) : path;
}

export function mk(ruleId, file, line, col, evidence, sourceLine) {
  return { rule_id: ruleId, file, line, col, evidence, source_line: sourceLine };
}

// The caller's excludes, merged with the defaults. core passes ATDD_SCAN_EXCLUDES
// (it carries `.atdd/workspaces`, among others) and cli/scan.py and adapter/run.py
// both merge it in; this family read only its own DEFAULT_EXCLUDES and discarded it.
// Matching follows lib/scan.mjs: a whole path segment OR a substring, so a
// multi-segment glob like `.atdd/workspaces` can match at all — segment-only
// comparison could never match one.
const SCAN_EXCLUDES = (() => {
  let extra = [];
  try {
    const raw = process.env.ATDD_SCAN_EXCLUDES;
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) extra = v.filter((x) => typeof x === "string");
    }
  } catch {
    /* malformed env must not silence the scan */
  }
  return [...new Set([...DEFAULT_EXCLUDES, ...extra])];
})();

function isExcluded(path) {
  return excludedPath(path, SCAN_EXCLUDES);
}

function hasChildDir(dir, name) {
  try {
    return statSync(join(dir, name)).isDirectory();
  } catch {
    return false;
  }
}

function* walkDirs(root) {
  let st;
  try {
    st = statSync(root);
  } catch {
    return;
  }
  if (!st.isDirectory()) return;
  yield root;
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (isExcluded(full)) continue;
    let cst;
    try {
      cst = statSync(full);
    } catch {
      continue;
    }
    if (cst.isDirectory()) yield* walkDirs(full);
  }
}

export function findConsumerRoots(scanRoot) {
  const roots = new Set();
  for (const d of walkDirs(scanRoot)) {
    if (hasChildDir(d, PLAN_ROOT) || hasChildDir(d, "e2e") || hasChildDir(d, "src")) roots.add(d);
  }
  return [...roots];
}

function* walkFiles(dir, pred) {
  let st;
  try {
    st = statSync(dir);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (pred(dir)) yield dir;
    return;
  }
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (isExcluded(full)) continue;
    let cst;
    try {
      cst = statSync(full);
    } catch {
      continue;
    }
    if (cst.isDirectory()) yield* walkFiles(full, pred);
    else if (pred(full)) yield full;
  }
}

const isYaml = (f) => f.endsWith(".yaml") || f.endsWith(".yml");
const isTs = (f) => f.endsWith(".ts") || f.endsWith(".tsx");

export function interlockingFiles(croot) {
  const base = join(croot, PLAN_ROOT, "_trains", "_interlockings");
  const out = [...walkFiles(base, isYaml)];
  const idx = join(croot, PLAN_ROOT, "_trains", "_interlockings.yaml");
  try {
    if (statSync(idx).isFile()) out.push(idx);
  } catch {
    /* absent */
  }
  return [...new Set(out)].sort();
}

export function e2eFiles(croot) {
  return [...walkFiles(join(croot, "e2e"), isTs)].sort();
}

// Interlocking YAML parse: interlocking_id + a non-empty routes list (core #1248, snake_case planner data).
// Registry/projection docs with no routes yield null. One parser for every detector, in lib/.
export { parseInterlocking } from "../../../lib/interlocking.mjs";

export function lineOf(text, pattern, def = 1) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (pattern.test(lines[i])) return [i + 1, lines[i]];
  return [def, ""];
}

// A token appears not flanked by identifier chars (allowing the id chars used in route/train ids).
export function tokenCovered(token, text) {
  if (!token) return false;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?<![\\w-])" + esc + "(?![\\w-])").test(text);
}

// A train id is unique, so naming it covers the route. A route id is not: `refuse` or `record` can be routes of several
// interlockings, and a test of one must not cover the others (FWS #liu3vKZYAPXD). A route id counts only in a test that
// also names its interlocking, by id or slug.
export function isRouteCovered(route, e2eTexts, interlockingId = null) {
  const slug = interlockingId ? interlockingId.replace(/^interlocking:/, "") : null;
  const ownInterlocking = (t) => !interlockingId || tokenCovered(interlockingId, t) || tokenCovered(slug, t);
  return e2eTexts.some((t) => tokenCovered(route.trainId, t) || (tokenCovered(route.routeId, t) && ownInterlocking(t)));
}

export function interlockingTokenSet(records) {
  const tokens = new Set();
  for (const rec of records) {
    tokens.add(rec.interlockingId);
    for (const r of rec.routes) {
      if (r.routeId) tokens.add(r.routeId);
      if (r.trainId) tokens.add(r.trainId);
    }
  }
  return [...tokens].filter(Boolean);
}

export function isInterlockingTest(text, tokens) {
  if (text.includes(PROD_INTERLOCKING) || text.includes(PROD_TRAIN) || text.includes("resolveTrain")) {
    return true;
  }
  return tokens.some((t) => tokenCovered(t, text));
}

// Semantic witnesses for the production call model.  Tokens get us to a candidate test; these
// small, deliberately conservative recognisers decide whether the candidate actually connects
// `InterlockingRunner.resolveTrain()` to `TrainRunner.execute()` and asserts evidence from that
// chain.  We keep this in the shared layer so route, runner, trace, smoke, and sequence checks
// cannot quietly drift back to accepting a different descriptive proxy.
const ident = "[A-Za-z_$][\\w$]*";

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function productionReceivers(text) {
  const out = new Set();
  const allocated = new RegExp(`\\b(?:const|let|var)\\s+(${ident})\\s*=\\s*new\\s+${PROD_INTERLOCKING}\\b`, "g");
  for (const m of text.matchAll(allocated)) out.add(m[1]);
  const factories = new RegExp(`\\bfunction\\s+(${ident})\\s*\\([^)]*\\)\\s*\\{[\\s\\S]{0,600}?\\breturn\\s+new\\s+${PROD_INTERLOCKING}\\b`, "g");
  for (const m of text.matchAll(factories)) out.add(`${m[1]}()`);
  return out;
}

// [{ resolution, execution }] means an actual resolution value feeds actual train execution.
// `execution` is null for an unassigned execute result; route/runner proof may assert resolution,
// while trace and sequence proof require the named execution result.
export function productionExecutionProofs(text) {
  const receivers = productionReceivers(text);
  const proofs = [];
  const resolutions = new RegExp(`\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*([^\\n]{0,240}?)\\.resolveTrain\\s*\\(`, "g");
  for (const m of text.matchAll(resolutions)) {
    const [whole, resolution, receiver] = m;
    const direct = new RegExp(`new\\s+${PROD_INTERLOCKING}\\b`).test(receiver);
    const named = [...receivers].some((name) => receiver.trim().endsWith(name));
    if (!direct && !named) continue;
    const after = text.slice((m.index ?? 0) + whole.length);
    const execute = new RegExp(`\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*new\\s+${PROD_TRAIN}\\s*\\(\\s*${escaped(resolution)}\\.(?:trainId|selectedTrainId)\\s*\\)\\s*\\.execute\\s*\\(`).exec(after);
    const anonymous = new RegExp(`new\\s+${PROD_TRAIN}\\s*\\(\\s*${escaped(resolution)}\\.(?:trainId|selectedTrainId)\\s*\\)\\s*\\.execute\\s*\\(`).test(after);
    if (execute || anonymous) proofs.push({ resolution, execution: execute?.[1] ?? null });
  }
  return proofs;
}

export function assertsExpression(text, expression, expected = null) {
  const pat = new RegExp(`\\bexpect\\s*\\(\\s*(?:await\\s+)?${expression}\\s*\\)\\s*\\.(?:to(?:Be|BeDefined|Equal|StrictEqual|Contain|ContainEqual|Match|BeTruthy)|not\\.to(?:Be|BeDefined|Equal|StrictEqual|Contain|ContainEqual|Match))\\b([\\s\\S]{0,220})`);
  const m = pat.exec(text);
  return Boolean(m && (!expected || tokenCovered(expected, m[0])));
}

export function hasProductionExecutionProof(text) {
  return productionExecutionProofs(text).some(({ resolution, execution }) => {
    if (assertsExpression(text, `${escaped(resolution)}\\.(?:routeId|trainId|selectedTrainId)`) ||
      (execution && assertsExpression(text, escaped(execution)))) return true;
    if (!execution) return false;
    const trace = new RegExp(`\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*(?:await\\s+)?${escaped(execution)}\\.trace\\b`).exec(text)?.[1];
    return Boolean(trace && REQUIRED_TRACE_FIELDS.some(([field]) => assertsExpression(text, `${escaped(trace)}\\.${field}`)));
  });
}

export function routeHasProductionProof(route, text, interlockingId = null) {
  const slug = interlockingId?.replace(/^interlocking:/, "");
  return productionExecutionProofs(text).some(({ resolution, execution }) => {
    const assertedRoute = assertsExpression(text, `${escaped(resolution)}\\.routeId`, route.routeId);
    const assertedTrain = assertsExpression(text, `${escaped(resolution)}\\.(?:trainId|selectedTrainId)`, route.trainId);
    const scoped = !interlockingId || tokenCovered(interlockingId, text) || tokenCovered(slug, text);
    return (assertedRoute && scoped) || assertedTrain || Boolean(scoped && execution && assertsExpression(text, escaped(execution)) && (tokenCovered(route.routeId, text) || tokenCovered(route.trainId, text)));
  });
}

export function traceHasProductionProvenance(text) {
  return productionExecutionProofs(text).some(({ execution }) => {
    if (!execution) return false;
    const trace = new RegExp(`\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*(?:await\\s+)?${escaped(execution)}\\.trace\\b`).exec(text)?.[1];
    return Boolean(trace);
  });
}

export function assertedTraceFields(text, traceName = "trace") {
  return REQUIRED_TRACE_FIELDS.filter(([field]) => !assertsExpression(text, `${escaped(traceName)}\\.${field}`)).map(([field]) => field);
}

// A smoke path has a real Station Master call and observes that call's returned value; separately
// requiring both production runner instances rules out imports used only as lexical decoration.
export function stationMasterExecutionProof(text, action) {
  const call = new RegExp(`\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*(?:await\\s+)?${ident}\\.(?:handleAction|dispatch|executeAction)\\s*\\(\\s*["']${escaped(action)}["']`).exec(text);
  if (!call) return false;
  const result = call[1];
  const instanceProof = new RegExp(`\\bexpect\\s*\\(\\s*${ident}\\.(?:interlockingRunner|trainRunner)\\s*\\)\\s*\\.toBeInstanceOf\\s*\\(\\s*(?:${PROD_INTERLOCKING}|${PROD_TRAIN})\\s*\\)`, "g");
  const seen = new Set([...text.matchAll(instanceProof)].map((m) => m[0].includes(PROD_INTERLOCKING) ? PROD_INTERLOCKING : PROD_TRAIN));
  return seen.has(PROD_INTERLOCKING) && seen.has(PROD_TRAIN) && assertsExpression(text, `${escaped(result)}(?:\\.[A-Za-z_$][\\w$]*)?`);
}

// HTTP/module entrypoints do not expose a StationMaster instance to the test. Their equivalent
// witness is an asserted dispatch result plus a module body that resolves and executes the selected
// train; this keeps an end-to-end smoke from having to pierce the public boundary for private fields.
export function stationModuleExecutionProof(text, stationText) {
  if (!stationText || !new RegExp(`new\\s+${PROD_INTERLOCKING}\\b`).test(stationText) ||
    !/\.resolveTrain\s*\(/.test(stationText) || !new RegExp(`new\\s+${PROD_TRAIN}\\b`).test(stationText) ||
    !/\.execute\s*\(/.test(stationText)) return false;
  const call = new RegExp(`\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*await\\s+(?:${ident}\\.)?(?:dispatch|handleAction|executeAction)\\s*\\(`).exec(text);
  return Boolean(call && assertsExpression(text, escaped(call[1])));
}

// Bun's native `expect` vocabulary provides a compact mutation witness: exact ordered equality
// kills reorder/removal mutants, objectContaining records a handoff edge, and at(-1) observes the
// final wagon.  All three must be about the TrainRunner result, never a hand-built literal.
export function hasSequenceMutationProof(text, trainId) {
  return productionExecutionProofs(text).some(({ resolution, execution }) => {
    if (!execution || !assertsExpression(text, `${escaped(resolution)}\\.(?:trainId|selectedTrainId)`, trainId)) return false;
    const result = escaped(execution);
    const ordered = new RegExp(`expect\\s*\\(\\s*${result}\\.(?:steps|sequence|wagons)\\s*\\)\\s*\\.to(?:Equal|StrictEqual)\\s*\\(\\s*\\[`, "s").test(text);
    const handoff = new RegExp(`expect\\s*\\(\\s*${result}\\.(?:steps|sequence|wagons)\\s*\\)\\s*\\.toContainEqual\\s*\\(\\s*expect\\.objectContaining\\s*\\(\\s*\\{[\\s\\S]{0,240}?(?:from|to)\\s*:`, "s").test(text);
    const finalWagon = new RegExp(`expect\\s*\\(\\s*${result}\\.(?:steps|sequence|wagons)\\s*\\.at\\(\\s*-1\\s*\\)\\s*\\)\\s*\\.to(?:Be|Equal|StrictEqual|Match)`, "s").test(text);
    return ordered && handoff && finalWagon;
  });
}

export function writeReport(violations) {
  const rp = process.env.ATDD_VIOLATIONS_REPORT;
  if (!rp) {
    process.stderr.write("convex-interlocking-coverage: ATDD_VIOLATIONS_REPORT not set\n");
    process.exit(2);
  }
  writeFileSync(rp, JSON.stringify({ violations }, null, 2), "utf8");
  process.exit(0);
}

// A route whose train passes through a wagon with no source yet is pending: the plan promises it, and nothing exists to
// drive yet. The route rules skip it until every wagon on its train has source, then judge it. Derived from the plan and
// the source tree, never declared, so it cannot be used to park a route; topology keeps reporting the missing source.
const pendingCache = new Map();
export function unbuiltWagons(croot, trainId) {
  if (!trainId) return [];
  let byTrain = pendingCache.get(croot);
  if (!byTrain) {
    byTrain = new Map();
    let sourceRoot = "src/wagons";
    try { sourceRoot = Bun.YAML.parse(readText(join(croot, "atdd-bun.yaml")))?.topology?.source_root || sourceRoot; } catch { /* default layout */ }
    const hasSource = (wagon) => [...walkFiles(join(croot, sourceRoot, wagon), isTs)].some((f) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
    const produces = new Map();
    (function rec(dir) {
      let entries;
      try { entries = readdirSync(dir).sort(); } catch { return; }
      for (const name of entries) {
        const full = join(dir, name);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) { if (name !== "_interlockings") rec(full); continue; }
        if (!/\.ya?ml$/.test(name)) continue;
        let doc;
        try { doc = Bun.YAML.parse(readText(full)); } catch { continue; }
        if (doc && typeof doc.wagon === "string" && Array.isArray(doc.produce))
          produces.set(doc.wagon.trim(), doc.produce.map((p) => p?.name).filter((name) => typeof name === "string" && name));
        if (!doc || typeof doc.train_id !== "string" || !Array.isArray(doc.sequence)) continue;
        const wagons = new Set(doc.sequence.flatMap((step) => [step?.from, step?.to]).filter((end) => typeof end === "string" && end.startsWith("wagon:")).map((end) => end.slice(6).trim()));
        byTrain.set(doc.train_id, [...wagons]);
      }
    })(join(croot, PLAN_ROOT));
    // Only a repository that keeps wagon code under the source root can show a wagon as not built yet. Where no wagon has
    // source there (the code lives elsewhere, as in decision-os), nothing is pending and every route is judged.
    // A wagon coded outside the source root is built all the same when Cargo-moving code names an artifact it produces:
    // the wagon-contract rule's own evidence (C1 #lVuJXXe3mM9E). Comments are masked, tests are not read.
    let cargoCode = null;
    const named = (wagon) => {
      const names = produces.get(wagon) ?? [];
      if (!names.length) return false;
      cargoCode ??= [...walkFiles(croot, isTs)].filter((f) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(f)).map((f) => readText(f) ?? "")
        .filter((text) => /\bCargo\b|\bcargo\s*\.\s*(?:put|get)\s*\(/.test(text))
        .map((text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1")).join("\n");
      return names.some((name) => cargoCode.includes(name));
    };
    const built = new Map([...new Set([...byTrain.values()].flat())].map((wagon) => [wagon, hasSource(wagon) || named(wagon)]));
    const layoutInUse = [...built.values()].some(Boolean);
    for (const [trainId, wagons] of byTrain) byTrain.set(trainId, layoutInUse ? wagons.filter((wagon) => !built.get(wagon)) : []);
    pendingCache.set(croot, byTrain);
  }
  return byTrain.get(trainId) ?? [];
}
