#!/usr/bin/env bun
// Detector: coder.bun.interlocking-bilateral-binding  (disposition: strict, severity 1)
//
// Bun/TS realization of the core python `interlocking_binding.py` detector — the single EXTENSION
// obligation that makes train interlocking SYSTEMIC. An interlocking system requires CLOSURE across
// declaration (the interlocking YAML route space, core afokapu/atdd#1248), runtime resolution
// (InterlockingRunner, #1251), Station Master reachability (the server.ts JOURNEY_MAP), TrainRunner
// delegation, and the execution trace. This detector emits RAW v1.1 violations under ONE rule_id for
// any of FIVE binding directions that is broken, plus a schema-drift signal for a parallel reachability
// field that forks core #1248's `entrypoint`:
//
//   declaration_to_runtime — every declared route's train artifact exists (runtime can resolve it).
//   runtime_to_declaration — the runtime never resolves a routeId/trainId absent from the loaded YAML.
//   station_to_declaration — every JOURNEY_MAP {interlockingId, path} mapping points to an existing YAML.
//   declaration_to_station — every exposed interlocking is reachable via a declared entrypoint.action.
//   trace_to_declaration   — every asserted trace routeId/interlockingId binds back to a declared route.
//   parallel_reachability_field — a forked reachability field is rejected as schema drift.
//
// CONTRACT (atdd.workspace.bun v1.1): reads ATDD_SCAN_ROOTS, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT, exits 0.
// Zero third-party deps — node builtins only. The plan/_trains interlocking YAML route space is
// stack-neutral planner data (snake_case, core #1248); the runtime + JOURNEY_MAP + trace are Bun/TS.

import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { scanExecution } from "./checks/interlocking_runtime_executes.mjs";
import { join, sep, resolve } from "node:path";

const RULE = "coder.bun.interlocking-bilateral-binding";
const DEFAULT_EXCLUDES = ["_generated", "node_modules", "dist", "build", ".next"];
const PARALLEL_FIELDS = ["entrypoints", "runtime_exposure", "station_actions", "exposed_actions", "reachability"];

// ── generic IO / masking ─────────────────────────────────────────────────────

function readText(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function lineOfIndex(text, idx) {
  return text.slice(0, idx).split("\n").length;
}

function lineAt(text, lineno) {
  const lines = text.split(/\r?\n/);
  return lineno >= 1 && lineno <= lines.length ? lines[lineno - 1].trim() : "";
}

// Blank `//` and `/* */` comments to spaces (offsets/newlines preserved); keep string literals.
function maskComments(text) {
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

// ── consumer-tree + scope discovery ──────────────────────────────────────────

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
  const segments = path.split(sep);
  return SCAN_EXCLUDES.some((ex) => segments.includes(ex) || path.includes(ex));
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

function findConsumerRoots(scanRoot) {
  const roots = new Set();
  for (const d of walkDirs(scanRoot)) {
    if (hasChildDir(d, "src") || hasChildDir(d, "plan") || hasChildDir(d, "e2e")) roots.add(d);
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

function interlockingFiles(croot) {
  const base = join(croot, "plan", "_trains", "_interlockings");
  const out = [...walkFiles(base, isYaml)];
  const idx = join(croot, "plan", "_trains", "_interlockings.yaml");
  try {
    if (statSync(idx).isFile()) out.push(idx);
  } catch {
    /* absent */
  }
  return [...new Set(out)].sort();
}

function runtimeFiles(croot) {
  return [...walkFiles(join(croot, "src", "trains"), isTs)].sort();
}

function e2eFiles(croot) {
  return [...walkFiles(join(croot, "e2e"), isTs)].sort();
}

// The Station Master is the module that DECLARES a JOURNEY_MAP, not a file with a
// particular name. This was `join(croot, "server.ts")`, which made the rule and
// coder.bun.dead-code-reachability mutually unsatisfiable: ts_metrics only treats
// index/wagon/composition/main/app as structural roots, so a consumer whose Station
// Master is server.ts had its whole feature tree reported dead, and renaming it to
// app.ts made the Station Master invisible here. No filename satisfied both. Named
// files are still checked first, so the common layout costs no extra walking.
function appFile(croot) {
  for (const name of ["server.ts", "app.ts", "main.ts", "index.ts"]) {
    const p = join(croot, name);
    try {
      if (statSync(p).isFile() && /\bJOURNEY_MAP\b/.test(readText(p))) return p;
    } catch {
      /* absent */
    }
  }
  for (const f of walkFiles(croot, isTs)) {
    if (/\bJOURNEY_MAP\b/.test(readText(f))) return f;
  }
  return null;
}

function rel(path, root) {
  const r = root.endsWith(sep) ? root : root + sep;
  return path.startsWith(r) ? path.slice(r.length) : path;
}

// ── interlocking YAML parse (CONSUMES core #1248 fields; snake_case planner data) ─────────────

function parseInterlocking(text) {
  const lines = text.split(/\r?\n/);
  const idM = text.match(/^interlocking_id:\s*["']?([^"'#\n]+?)["']?\s*(?:#.*)?$/m);
  if (!idM) return null;
  const interlockingId = idM[1].trim();

  const routes = [];
  const ri = lines.findIndex((l) => /^routes:\s*(?:#.*)?$/.test(l));
  if (ri >= 0) {
    for (let i = ri + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\S/.test(l)) break; // dedent to a new top-level key ends the routes block
      const rm = l.match(/^\s*-\s*route_id:\s*["']?([^"'#\n]+?)["']?\s*(?:#.*)?$/);
      if (rm) {
        routes.push({ routeId: rm[1].trim(), line: i + 1, sourceLine: l, trainId: null, trainPath: null });
      } else if (routes.length) {
        const cur = routes[routes.length - 1];
        const tm = l.match(/^\s*train_id:\s*["']?([^"'#\n]+?)["']?\s*(?:#.*)?$/);
        if (tm) cur.trainId = tm[1].trim();
        const pm = l.match(/^\s*train_path:\s*["']?([^"'#\n]+?)["']?\s*(?:#.*)?$/);
        if (pm) cur.trainPath = pm[1].trim();
      }
    }
  }
  if (!routes.length) return null;

  let exposed = false;
  const actions = [];
  const ei = lines.findIndex((l) => /^entrypoint:\s*(?:#.*)?$/.test(l));
  if (ei >= 0) {
    for (let i = ei + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\S/.test(l)) break; // dedent ends the entrypoint block
      if (/^\s*exposed:\s*true\b/.test(l)) exposed = true;
      // FLOW STYLE TOO: `actions: [resolve_match, other]`.
      //
      // The interlocking YAML is stack-neutral planner data and flow sequences are
      // ordinary YAML. Python reads it with a real parser and accepts both; this
      // hand-rolled line scanner accepted only block style, so the SAME plan file
      // was judged differently depending on which stack read it — and the verdict
      // was "exposed interlocking is not Station-Master-reachable", a strict
      // blocking finding, against a consumer whose YAML was perfectly valid.
      // Found by running this provider against a Bun consumer written from scratch.
      const flow = l.match(/^\s*actions:\s*\[([^\]]*)\]\s*(?:#.*)?$/);
      if (flow) {
        for (const raw of flow[1].split(",")) {
          const a = raw.trim().replace(/^["']|["']$/g, "");
          if (a) actions.push(a);
        }
        continue;
      }
      if (/^\s*actions:\s*(?:#.*)?$/.test(l)) {
        for (let j = i + 1; j < lines.length; j++) {
          const am = lines[j].match(/^\s*-\s*["']?([^"'#\n]+?)["']?\s*(?:#.*)?$/);
          if (am) actions.push(am[1].trim());
          else break;
        }
      }
    }
  }

  const parallelFields = PARALLEL_FIELDS.filter((f) => new RegExp("^\\s*" + f + "\\s*:", "m").test(text));
  return { interlockingId, routes, exposed, actions, parallelFields, rawText: text };
}

// ── Station Master JOURNEY_MAP parse (server.ts) ─────────────────────────

function parseJourneyMap(rawText) {
  const text = maskComments(rawText);
  const m = /\bJOURNEY_MAP\b[^=]*=\s*\{/.exec(text);
  if (!m) return {};
  const open = m.index + m[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const bodyStart = open + 1;
  const body = text.slice(bodyStart, close < 0 ? text.length : close);
  const out = {};
  let re = /(?:([A-Za-z_$][\w$]*)|"([^"]+)"|'([^']+)')\s*:\s*\{([^{}]*)\}/g;
  let mm;
  while ((mm = re.exec(body)) !== null) {
    const action = mm[1] || mm[2] || mm[3];
    const inner = mm[4];
    const idm = inner.match(/interlockingId\s*:\s*["']([^"']+)["']/);
    const pm = inner.match(/path\s*:\s*["']([^"']+)["']/);
    if (idm || pm) {
      out[action] = {
        kind: "interlocking",
        interlockingId: idm ? idm[1] : null,
        path: pm ? pm[1] : null,
        line: lineOfIndex(rawText, bodyStart + mm.index),
      };
    }
  }
  re = /(?:([A-Za-z_$][\w$]*)|"([^"]+)"|'([^']+)')\s*:\s*["']([^"']+)["']\s*[,}]/g;
  while ((mm = re.exec(body)) !== null) {
    const action = mm[1] || mm[2] || mm[3];
    if (!(action in out)) {
      out[action] = { kind: "direct", trainId: mm[4], line: lineOfIndex(rawText, bodyStart + mm.index) };
    }
  }
  return out;
}

// Resolution-output object properties the runtime sets (core #1251 InterlockingResolution).
function runtimeResolutionLiterals(rawText) {
  const text = maskComments(rawText);
  const out = [];
  let re = /\brouteId\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ kind: "route", value: m[1], line: lineOfIndex(rawText, m.index) });
  re = /\b(?:trainId|selectedTrainId)\s*:\s*["']([^"']+)["']/g;
  while ((m = re.exec(text)) !== null) out.push({ kind: "train", value: m[1], line: lineOfIndex(rawText, m.index) });
  return out;
}

const TRACE_OBJECT = /\btrace\b/;
// Matches both a bare `trace.routeId === "X"` / `trace["routeId"] === "X"` comparison AND the
// vitest/jest `expect(trace.routeId).toBe("X")` / `.toEqual(...)` / `.toStrictEqual(...)` form.
const TRACE_ASSERT =
  /trace\s*(?:\.\s*(routeId|interlockingId)|\[\s*["'](routeId|interlockingId)["']\s*\])\s*(?:===?\s*|\)\s*\.\s*to(?:Be|Equal|StrictEqual)\s*\(\s*)["']([^"']+)["']/g;

// ── violation helper ─────────────────────────────────────────────────────────

function mk(file, line, direction, detail, sourceLine) {
  return { rule_id: RULE, file, line, col: 0, evidence: `${direction}: ${detail}`, source_line: sourceLine };
}

function trainArtifactExists(croot, route) {
  if (route.trainPath) {
    try {
      return statSync(join(croot, route.trainPath)).isFile();
    } catch {
      return false;
    }
  }
  if (route.trainId) {
    try {
      return statSync(join(croot, "plan", "_trains", `${route.trainId}.yaml`)).isFile();
    } catch {
      return false;
    }
  }
  return false;
}

// ── per-consumer-tree scan ───────────────────────────────────────────────────

function scanConsumerRoot(croot) {
  const records = [];
  for (const f of interlockingFiles(croot)) {
    const rec = parseInterlocking(readText(f));
    if (rec) records.push({ file: f, ...rec });
  }
  const runtime = runtimeFiles(croot).map((f) => ({ file: f, text: readText(f) }));
  const app = appFile(croot);
  const appText = app ? readText(app) : "";
  const journey = app ? parseJourneyMap(appText) : {};
  const e2e = e2eFiles(croot).map((f) => ({ file: f, text: readText(f) }));

  const enabled =
    records.length > 0 ||
    runtime.some((r) => /InterlockingRunner|InterlockingResolution/.test(r.text));
  if (!enabled) return [];

  const declaredRoutes = new Set(records.flatMap((r) => r.routes.map((x) => x.routeId)));
  const declaredTrains = new Set(records.flatMap((r) => r.routes.map((x) => x.trainId).filter(Boolean)));
  const declaredIds = new Set(records.map((r) => r.interlockingId));
  const violations = [];

  // 1. declaration_to_runtime
  for (const rec of records) {
    for (const route of rec.routes) {
      if (trainArtifactExists(croot, route)) continue;
      const target = route.trainPath || (route.trainId ? `plan/_trains/${route.trainId}.yaml` : "<no train_id>");
      violations.push(
        mk(
          rel(rec.file, croot),
          route.line,
          "declaration_to_runtime",
          `declared route "${route.routeId}" of interlocking "${rec.interlockingId}" is not runtime-resolvable: ` +
            `its train artifact "${target}" does not exist, so InterlockingRunner -> TrainRunner cannot resolve it`,
          route.sourceLine.trim(),
        ),
      );
    }
  }

  // 2. runtime_to_declaration (no hidden routes)
  for (const { file, text } of runtime) {
    if (!/InterlockingResolution|resolveTrain/.test(text)) continue;
    for (const lit of runtimeResolutionLiterals(text)) {
      const declared = lit.kind === "route" ? declaredRoutes : declaredTrains;
      if (declared.has(lit.value)) continue;
      const label = lit.kind === "route" ? "routeId" : "trainId";
      violations.push(
        mk(
          rel(file, croot),
          lit.line,
          "runtime_to_declaration",
          `InterlockingRunner resolves ${label} "${lit.value}" which is declared in no interlocking YAML ` +
            `(hidden route); every resolved route/train must come from the loaded route space`,
          lineAt(text, lit.line),
        ),
      );
    }
  }

  // 3. station_to_declaration (mappings point to existing YAML)
  if (app) {
    for (const [action, mapping] of Object.entries(journey)) {
      if (mapping.kind !== "interlocking") continue;
      if (mapping.path) {
        let exists = false;
        try {
          exists = statSync(join(croot, mapping.path)).isFile();
        } catch {
          exists = false;
        }
        if (!exists) {
          violations.push(
            mk(
              rel(app, croot),
              mapping.line,
              "station_to_declaration",
              `Station Master action "${action}" maps to interlocking path "${mapping.path}" which does not ` +
                `exist; the mapping must point to a real interlocking YAML`,
              lineAt(appText, mapping.line),
            ),
          );
        }
      }
      if (mapping.interlockingId && !declaredIds.has(mapping.interlockingId)) {
        violations.push(
          mk(
            rel(app, croot),
            mapping.line,
            "station_to_declaration",
            `Station Master action "${action}" maps to interlockingId "${mapping.interlockingId}" which is ` +
              `declared by no interlocking YAML in the route space`,
            lineAt(appText, mapping.line),
          ),
        );
      }
    }
  }

  // 4. declaration_to_station (exposed interlockings are reachable)
  for (const rec of records) {
    if (!rec.exposed) continue;
    const reachable = rec.actions.some((action) => {
      const mapping = journey[action];
      if (!mapping || mapping.kind !== "interlocking") return false;
      if (mapping.interlockingId === rec.interlockingId) return true;
      if (mapping.path && resolve(join(croot, mapping.path)) === resolve(rec.file)) return true;
      return false;
    });
    if (reachable) continue;
    const m = /^\s*exposed:\s*true\b.*$/m.exec(rec.rawText);
    const line = m ? lineOfIndex(rec.rawText, m.index) : 1;
    const actions = rec.actions.join(", ") || "<none>";
    violations.push(
      mk(
        rel(rec.file, croot),
        line,
        "declaration_to_station",
        `interlocking "${rec.interlockingId}" has entrypoint.exposed:true but is not Station-Master-reachable: ` +
          `none of its entrypoint.actions [${actions}] is wired into JOURNEY_MAP to this interlocking ` +
          `(core afokapu/atdd#1248 entrypoint.exposed/actions)`,
        m ? m[0].trim() : "",
      ),
    );
  }

  // schema drift — parallel reachability field
  for (const rec of records) {
    for (const field of rec.parallelFields) {
      const m = new RegExp("^\\s*" + field + "\\s*:.*$", "m").exec(rec.rawText);
      const line = m ? lineOfIndex(rec.rawText, m.index) : 1;
      violations.push(
        mk(
          rel(rec.file, croot),
          line,
          "parallel_reachability_field",
          `interlocking "${rec.interlockingId}" declares a parallel reachability field "${field}"; reachability ` +
            `is owned by core afokapu/atdd#1248's \`entrypoint\` (exposed/actions/reason) — this extension must ` +
            `not fork it (schema drift)`,
          m ? m[0].trim() : "",
        ),
      );
    }
  }

  // 5. trace_to_declaration (trace binds back to source YAML)
  for (const { file, text } of e2e) {
    if (!TRACE_OBJECT.test(text)) continue;
    TRACE_ASSERT.lastIndex = 0;
    let m;
    while ((m = TRACE_ASSERT.exec(text)) !== null) {
      const field = m[1] || m[2];
      const value = m[3];
      const declared = field === "interlockingId" ? declaredIds : declaredRoutes;
      if (declared.has(value)) continue;
      const line = lineOfIndex(text, m.index);
      // ANCHORED AT THE DECLARATION, NOT THE TEST — deliberately.
      //
      // This is a CODER rule, and this provider's persona doctrine
      // (conformance/test_persona_scoping.py) is that a coder family never REPORTS
      // on a test file: a consumer adopting atdd.extension.coder.bun without the
      // tester extension would otherwise see a coder rule_id land on a .test.ts,
      // which is the cross-contamination that stops the two extensions being
      // adopted and ratcheted independently.
      //
      // Nothing is lost. The finding is a statement about CLOSURE of the declared
      // route space — "something asserts a route this space does not contain" — so
      // the route space is the honest anchor, and the offending test file and line
      // are named in the evidence. Reading the test is fine; reporting on it is not.
      const anchor = interlockingPathFor(croot, value, field) || rel(file, croot);
      violations.push(
        mk(
          anchor,
          anchor === rel(file, croot) ? line : 1,
          "trace_to_declaration",
          `interlocking trace test "${rel(file, croot)}" (line ${line}) asserts trace.${field} === ` +
            `"${value}", which resolves to no declared ` +
            `${field === "interlockingId" ? "interlocking" : "route"} in the YAML route space; the trace must ` +
            `bind the executed route back to its declaration`,
          lineAt(text, line),
        ),
      );
    }
  }

  return violations;
}


// The declaration this closure statement is about: the interlocking route space.
// Used to anchor trace_to_declaration findings at the YAML rather than at a test file
// (see the note at the report site). Falls back to null when no route space is found,
// in which case the caller keeps its original anchor.
function interlockingPathFor(croot, _value, _field) {
  const files = interlockingFiles(croot);
  return files.length ? rel(files[0], croot) : null;
}

function main() {
  const reportPath = process.env.ATDD_VIOLATIONS_REPORT;
  if (!reportPath) {
    process.stderr.write("bun-interlocking-binding: ATDD_VIOLATIONS_REPORT not set\n");
    process.exit(2);
  }
  const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
  const violations = [];
  for (const scanRoot of roots) {
    for (const croot of findConsumerRoots(scanRoot)) violations.push(...scanConsumerRoot(croot));
    // coder.bun.runtime-executes-the-declaration — no longer staged. This family is
    // monolithic rather than checks/-collecting, so it is called here rather than
    // discovered.
    violations.push(...scanExecution(scanRoot));
  }
  writeFileSync(reportPath, JSON.stringify({ violations }, null, 2), "utf8");
  process.stderr.write(`bun-interlocking-binding: ${violations.length} violation(s)\n`);
  process.exit(0);
}

main();
