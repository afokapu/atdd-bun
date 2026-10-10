// Shared helpers for the bun_interlocking_coverage FAMILY detector.
// Bun/TS realization of the core python `interlocking_coverage.py` detector (core
// afokapu/atdd#1248 route space + #1251 runner call model). Each check under ../checks/*.mjs imports
// this module and scans a consumer tree for ONE tester.bun.interlocking-* rule.
//
// Node builtins only, except lib/journey-chain.mjs, which proves the journey-mediated chain on the
// TypeScript compiler AST. The interlocking route space is stack-neutral planner
// data (snake_case, plan/_trains/_interlockings/**); the e2e tests are Bun/TS under e2e/**.

import { excludedPath } from "../../../lib/scan.mjs";
import { entryDelegatedAction, provenJourneyAction } from "../../../lib/journey-chain.mjs";
import { existsSync, readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

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
function resolvedLocalNamedImport(text, file, croot, symbol) {
  if (!file || !croot) return null;
  const re = /^\s*import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/gm;
  for (const match of text.matchAll(re)) {
    if (!match[2].startsWith(".")) continue;
    const names = match[1].split(",").map(name => name.trim().split(/\s+as\s+/)[0]);
    if (!names.includes(symbol)) continue;
    const target = resolve(dirname(file), match[2]);
    const candidates = [target, `${target}.ts`, `${target}.tsx`, `${target}.js`, `${target}.mjs`, join(target, "index.ts")];
    const source = candidates.find(candidate => existsSync(candidate) && candidate.startsWith(resolve(croot) + sep) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(candidate));
    if (source) return source;
  }
  return null;
}

export function hasResolvedProductionRunnerImports(text, file, croot) {
  return Boolean(
    resolvedLocalNamedImport(text, file, croot, PROD_INTERLOCKING) &&
    resolvedLocalNamedImport(text, file, croot, PROD_TRAIN),
  );
}

// Index just past a string or comment starting at `i`, or `i` itself when `i` starts code.
function skipLiteral(text, i) {
  const c = text[i], next = text[i + 1];
  if (c === "/" && next === "/") { const end = text.indexOf("\n", i + 2); return end < 0 ? text.length : end; }
  if (c === "/" && next === "*") { const end = text.indexOf("*/", i + 2); return end < 0 ? text.length : end + 2; }
  if (c === "'" || c === '"' || c === "`") {
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === "\\") { j++; continue; }
      if (text[j] === c) return j + 1;
    }
    return text.length;
  }
  return i;
}

// Index of the first bracket that closes a scope opened before `text` begins.
function enclosingEnd(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const skip = skipLiteral(text, i);
    if (skip !== i) { i = skip - 1; continue; }
    if ("([{".includes(text[i])) depth++;
    else if (")]}".includes(text[i]) && --depth < 0) return i;
  }
  return text.length;
}

// A `return` statement ends at `;`, at the scope's closing bracket, or at a newline that cannot continue it.
function returnStatementEnd(text, start) {
  let depth = 0;
  for (let i = start + "return".length; i < text.length; i++) {
    const skip = skipLiteral(text, i);
    if (skip !== i) { i = skip - 1; continue; }
    const c = text[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (--depth < 0) return i; }
    else if (depth === 0 && c === ";") return i;
    else if (depth === 0 && c === "\n") {
      const head = text.slice(start + "return".length, i).trim();
      const next = text.slice(i + 1).trimStart()[0] ?? "";
      if (!head || (!/[=+\-*/%&|^?:,.!<>]$/.test(head) && !/^[.?:+\-*/%&|^,=<>)\]]/.test(next))) return i;
    }
  }
  return text.length;
}

// True when a statement starting at `index` is the body of a braceless `if (…)`, `for (…)`, `while (…)`, or `else`.
function conditionalStatement(text, index) {
  const before = maskComments(text.slice(0, index)).trimEnd();
  if (/(?:^|[^\w$.])else$/.test(before)) return true;
  if (!before.endsWith(")")) return false;
  let depth = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    if (before[i] === ")") depth++;
    else if (before[i] === "(" && --depth === 0) return /(?:^|[^\w$.])(?:if|for|while)\s*$/.test(before.slice(0, i));
  }
  return false;
}

// [[start, end]] of the first `return` that always runs when control reaches it at the top level of `text`
// (or [] when none does); anything after it is unreachable. Nested blocks, callbacks, and braceless
// conditional bodies are excluded; `try`/`finally` bodies are not.
function topLevelReturns(text) {
  const ranges = [], stack = [];
  for (let i = 0; i < text.length; i++) {
    const skip = skipLiteral(text, i);
    if (skip !== i) { i = skip - 1; continue; }
    const c = text[i];
    if ("([{".includes(c)) stack.push(c === "{" && /(?:^|[^\w$.])(?:try|finally)\s*$/.test(text.slice(Math.max(0, i - 16), i)) ? "always" : c);
    else if (")]}".includes(c)) { if (!stack.length) break; stack.pop(); }
    else if (stack.every((entry) => entry === "always") && text.startsWith("return", i) &&
      !/[\w$.]/.test(text[i - 1] ?? "") && !/[\w$]/.test(text[i + 6] ?? "") && !conditionalStatement(text, i)) {
      ranges.push([i, returnStatementEnd(text, i)]);
      break;
    }
  }
  return ranges;
}

// Operators that make an operand conditional, discarded, or replaced by another value: comma, ternary,
// short-circuit logic, arrows, unary/binary arithmetic and comparison, and `void`/`typeof`/`delete`/
// `instanceof`/`in`. A non-null `!` may follow a value, so only a prefix `!` counts.
const PREFIX_REPLACING = /^(?:\?(?![.?])|\?\?|&&|\|\||=>|[,:!~+\-*/%<>=&|^])|^(?:void|typeof|delete|instanceof|in)\b/;
const SUFFIX_REPLACING = /^(?:\?(?![.?])|\?\?|&&|\|\||[,:~+\-*/%<>=&|^])|^(?:instanceof|in)\b/;
const replacing = (pattern, text, i) => !/[\w$]/.test(text[i - 1] ?? "") || !/^[a-z]/.test(text[i]) ? pattern.exec(text.slice(i, i + 10)) : null;

function returnsValueAt(text, start, end, index) {
  const stack = [{ kind: "group", operator: false }];
  for (let i = start + "return".length; i < index; i++) {
    const skip = skipLiteral(text, i);
    if (skip !== i) { i = skip - 1; continue; }
    const c = text[i];
    if (c === "(") {
      const prev = text.slice(start, i);
      const group = /(?:^|[^\w$])(?:return|await|typeof|void|yield|in|of|case)\s*$/.test(prev) || !/[\w$)\]]\s*$/.test(prev);
      stack.push({ kind: group ? "group" : "call", operator: false });
    } else if ("[{".includes(c)) stack.push({ kind: c, operator: false });
    else if (")]}".includes(c)) stack.pop();
    else {
      const op = replacing(PREFIX_REPLACING, text, i);
      if (op) { stack.at(-1).operator = true; i += op[0].length - 1; }
    }
  }
  for (let level = stack.length - 1; level >= 0 && stack[level].kind === "group"; level--) if (stack[level].operator) return false;
  let depth = 0;
  for (let i = index; i < end; i++) {
    const skip = skipLiteral(text, i);
    if (skip !== i) { i = skip - 1; continue; }
    const c = text[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth > 0) depth--;
      else { stack.pop(); if (!stack.length || stack.at(-1).kind !== "group") return true; }
    } else if (depth === 0 && stack.at(-1).kind === "group" && replacing(SUFFIX_REPLACING, text, i)) return false;
  }
  return true;
}

// True when a match of `pattern` ending by `limit` is returned at the top level of `text`, inline or
// through a variable assigned from it.
function returnsMatch(text, pattern, limit = text.length) {
  const ranges = topLevelReturns(text);
  const returned = (index) => ranges.some(([start, end]) => index > start && index < end && returnsValueAt(text, start, end, index));
  for (const m of text.matchAll(new RegExp(pattern, "g"))) {
    if ((m.index ?? 0) + m[0].length <= limit && returned(m.index ?? 0)) return true;
  }
  const assigned = new RegExp(`\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*(?:await\\s+)?${pattern}`, "g");
  for (const m of text.matchAll(assigned)) {
    const after = (m.index ?? 0) + m[0].length;
    if (after > limit) continue;
    for (const ref of text.matchAll(new RegExp(`(?<![\\w$.])${escaped(m[1])}(?![\\w$])`, "g"))) {
      if ((ref.index ?? 0) >= after && returned(ref.index ?? 0)) return true;
    }
  }
  return false;
}

// Index of the first use of `name` that could rebind or mutate it. Allowed: member-chain reads (not
// assigned or called), object keys, `void`/`console.*` arguments, the execute argument matched by
// `executeArgument`, and object/array values inside a returned expression. An object or array holding the
// resolution anywhere else is an alias whose later member writes are invisible here, so it ends the binding.
function firstRebinding(text, name, executeArgument, returns) {
  for (const m of text.matchAll(new RegExp(`(?<![\\w$.])${escaped(name)}(?![\\w$])`, "g"))) {
    const index = m.index ?? 0;
    const before = text.slice(0, index), rest = text.slice(index + m[0].length);
    const chain = /^(?:\s*\??\.\s*[A-Za-z_$][\w$]*|\s*\[[^\]]*\])+/.exec(rest);
    if (chain) {
      if (/^\s*(?:=(?![=>])|\+\+|--|(?:\*\*|[-+*/%&|^]|<<|>>>?|\?\?|&&|\|\|)=|\()/.test(rest.slice(chain[0].length))) return index;
      continue;
    }
    if (new RegExp(`(?:${executeArgument})$`).test(before)) continue;
    if (/[{,]\s*$/.test(before) && /^\s*:/.test(rest)) continue; // an object key, not a reference
    if (/\bvoid\s+$/.test(before)) continue;
    if (/\bconsole\s*\.\s*(?:log|info|warn|error|debug|trace)\s*\(\s*$/.test(before) && /^\s*\)/.test(rest)) continue;
    if (/(?:[{,]\s*(?:[A-Za-z_$][\w$]*\s*:\s*)?|\[\s*)$/.test(before) && /^\s*[,}\]]/.test(rest) &&
      returns.some(([start, end]) => index > start && index < end)) continue;
    return index;
  }
  return text.length;
}

// `after` starts inside the `resolveTrain(` call that produced `resolution`. The binding holds only inside
// the block that declared the resolution, and only until the resolution is passed, aliased, assigned, or
// mutated anywhere other than the execution itself.
function resolutionBinding(after, resolution, executeArgument) {
  const statement = after.slice(enclosingEnd(after) + 1);
  const scope = statement.slice(0, enclosingEnd(statement));
  return { scope, bound: scope.slice(0, firstRebinding(scope, resolution, executeArgument, topLevelReturns(scope))) };
}

function trainExecutionForms(resolution) {
  const r = escaped(resolution);
  const legacy = `new\\s+${PROD_TRAIN}\\s*\\(\\s*${r}\\.(?:trainId|selectedTrainId)\\s*\\)\\s*\\.execute\\s*\\(`;
  // The declaration-driven runner form constructs from THIS resolution's trainPath (optionally followed
  // by handler/context args) and executes that same resolution object.
  const constructed = `new\\s+${PROD_TRAIN}\\s*\\(\\s*${r}\\.trainPath\\s*(?:,[^()]*)?\\)\\s*\\.execute\\s*\\(\\s*`;
  return { legacy, constructed, declaration: `${constructed}${r}\\s*(?:,|\\))` };
}

function resolutionTrainExecution(after, resolution) {
  const { legacy, constructed, declaration } = trainExecutionForms(resolution);
  const { scope, bound } = resolutionBinding(after, resolution, constructed);
  const assignment = `\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*(?:await\\s+)?`;
  const assigned = new RegExp(`${assignment}${legacy}`).exec(after) ?? new RegExp(`${assignment}${declaration}`).exec(bound);
  const returns = `\\breturn\\s+(?:await\\s+)?`;
  return {
    execution: assigned?.[1] ?? null,
    found: Boolean(assigned || new RegExp(legacy).test(after) || new RegExp(declaration).test(bound)),
    returned: new RegExp(`${returns}${legacy}`).test(after) || returnsMatch(scope, declaration, bound.length) ||
      Boolean(assigned && new RegExp(`${returns}${escaped(assigned[1])}\\s*;?`).test(after)),
  };
}

export function productionExecutionProofs(text, file, croot) {
  if (file && croot && !hasResolvedProductionRunnerImports(text, file, croot)) return [];
  const receivers = productionReceivers(text);
  const proofs = [];
  const resolutions = new RegExp(`\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*([^=;{}\\n]{0,240}?)\\.resolveTrain\\s*\\(`, "g");
  for (const m of text.matchAll(resolutions)) {
    const [whole, resolution, receiver] = m;
    const direct = new RegExp(`new\\s+${PROD_INTERLOCKING}\\b`).test(receiver);
    const named = [...receivers].some((name) => receiver.trim().endsWith(name));
    if (!direct && !named) continue;
    const proof = resolutionTrainExecution(text.slice((m.index ?? 0) + whole.length), resolution);
    if (proof.found) proofs.push({ resolution, execution: proof.execution });
  }
  return proofs;
}

export function assertsExpression(text, expression, expected = null) {
  const pat = new RegExp(`\\bexpect\\s*\\(\\s*(?:await\\s+)?${expression}\\s*\\)\\s*\\.(?:to(?:Be|BeDefined|Equal|StrictEqual|Contain|ContainEqual|MatchObject|Match|BeTruthy)|not\\.to(?:Be|BeDefined|Equal|StrictEqual|Contain|ContainEqual|MatchObject|Match))\\b([\\s\\S]{0,220})`);
  const m = pat.exec(text);
  return Boolean(m && (!expected || tokenCovered(expected, m[0])));
}

export function hasProductionExecutionProof(text, file, croot) {
  return productionExecutionProofs(text, file, croot).some(({ resolution, execution }) => {
    if (assertsExpression(text, `${escaped(resolution)}\\.(?:routeId|trainId|selectedTrainId)`) ||
      (execution && assertsExpression(text, escaped(execution)))) return true;
    if (!execution) return false;
    const trace = new RegExp(`\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*(?:await\\s+)?${escaped(execution)}\\.trace\\b`).exec(text)?.[1];
    return Boolean(trace && REQUIRED_TRACE_FIELDS.some(([field]) => assertsExpression(text, `${escaped(trace)}\\.${field}`)));
  });
}

export function routeHasProductionProof(route, text, interlockingId = null, file, croot) {
  const slug = interlockingId?.replace(/^interlocking:/, "");
  return productionExecutionProofs(text, file, croot).some(({ resolution, execution }) => {
    const assertedRoute = assertsExpression(text, `${escaped(resolution)}\\.routeId`, route.routeId);
    const assertedTrain = assertsExpression(text, `${escaped(resolution)}\\.(?:trainId|selectedTrainId)`, route.trainId);
    const scoped = !interlockingId || tokenCovered(interlockingId, text) || tokenCovered(slug, text);
    return (assertedRoute && scoped) || assertedTrain || Boolean(scoped && execution && assertsExpression(text, escaped(execution)) && (tokenCovered(route.routeId, text) || tokenCovered(route.trainId, text)));
  });
}

export function traceHasProductionProvenance(text, file, croot) {
  return productionExecutionProofs(text, file, croot).some(({ execution }) => {
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

function balancedBlock(text, open) {
  let depth = 0, quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "/" && next === "/") { i = text.indexOf("\n", i + 2); if (i < 0) return null; continue; }
    if (c === "/" && next === "*") { const end = text.indexOf("*/", i + 2); if (end < 0) return null; i = end + 1; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

function exportedActionBody(text, name) {
  const n = escaped(name);
  const headers = [
    new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${n}\\s*\\([^)]*\\)\\s*\\{`, "g"),
    new RegExp(`\\bexport\\s+(?:const|let|var)\\s+${n}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{`, "g"),
  ];
  for (const header of headers) {
    const match = header.exec(text);
    if (match) return balancedBlock(text, (match.index ?? 0) + match[0].lastIndexOf("{"));
  }
  return null;
}

// As on main, the exported action itself must resolve on a recognized InterlockingRunner and
// return that resolution's execution; a discarded or module-local execution is not evidence.
function directProductionModuleExecution(body, moduleText = body) {
  if (!new RegExp(`new\\s+${PROD_INTERLOCKING}\\b`).test(moduleText) || !new RegExp(`new\\s+${PROD_TRAIN}\\b`).test(moduleText)) return false;
  const receivers = productionReceivers(moduleText);
  const resolutions = new RegExp(`\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*([^=;{}\\n]{0,240}?)\\.resolveTrain\\s*\\(`, "g");
  return [...body.matchAll(resolutions)].some(match => {
    const recognized = new RegExp(`new\\s+${PROD_INTERLOCKING}\\b`).test(match[2]) ||
      [...receivers].some((name) => match[2].trim().endsWith(name));
    return recognized && resolutionTrainExecution(body.slice((match.index ?? 0) + match[0].length), match[1]).returned;
  });
}

// HTTP/module entrypoints do not expose a StationMaster instance to the test. Their equivalent
// witness is an asserted result from the same exported action the test invokes. That action must
// either directly execute the selected train or return a JourneyRunner execution whose local
// InterlockingRunner then executes the same resolution's declaration path.
function stationModuleCall(text, action) {
  return new RegExp(`\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*(?:await\\s+)?(?:${ident}\\.)?(dispatch|handleAction|executeAction)\\s*\\(\\s*["']${escaped(action)}["']`).exec(text);
}

export function stationModuleExecutionProof(text, stationText, action, stationFile, croot) {
  if (!stationText || !stationFile || !croot) return false;
  const call = stationModuleCall(text, action);
  if (call && assertsExpression(text, `${escaped(call[1])}(?:\\.[A-Za-z_$][\\w$]*)?`)) {
    // The journey-mediated chain is proven on the TypeScript AST (lib/journey-chain.mjs).
    if (provenJourneyAction(stationText, stationFile, croot, call[2])) return true;
    const body = exportedActionBody(stationText, call[2]);
    if (body && directProductionModuleExecution(body, stationText)) return true;
  }
  return stationEntryExecutionProof(text, stationText, action, stationFile, croot);
}

// An HTTP-shaped entry (e.g. `stationMaster(command)`) whose asserted result depends on its awaited
// call of a proven journey action with this literal action name.
function stationEntryExecutionProof(text, stationText, action, stationFile, croot) {
  const calls = new RegExp(`\\b(?:const|let|var)\\s+(${ident})(?:\\s*:\\s*[^=;\\n]+)?\\s*=\\s*(?:await\\s+)?(${ident})\\s*\\(`, "g");
  return [...text.matchAll(calls)].some(([, result, entry]) => {
    const delegated = entryDelegatedAction(stationText, stationFile, entry);
    return Boolean(delegated && delegated.action === action &&
      assertsExpression(text, `${escaped(result)}(?:\\.[A-Za-z_$][\\w$]*)?`) &&
      provenJourneyAction(stationText, stationFile, croot, delegated.callee));
  });
}

export function routeHasStationModuleProof(route, text, action, stationText, stationFile, croot) {
  const call = stationModuleCall(text, action);
  return Boolean(call && stationModuleExecutionProof(text, stationText, action, stationFile, croot) &&
    assertsExpression(text, `${escaped(call[1])}\\.selectedTrainId`, route.trainId));
}

// Bun's native `expect` vocabulary provides a compact mutation witness: exact ordered equality
// kills reorder/removal mutants, objectContaining records a handoff edge, and at(-1) observes the
// final wagon.  All three must be about the TrainRunner result, never a hand-built literal.
export function hasSequenceMutationProof(text, trainId, file, croot) {
  return productionExecutionProofs(text, file, croot).some(({ resolution, execution }) => {
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
