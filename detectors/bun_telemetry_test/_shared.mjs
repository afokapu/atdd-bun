// _shared.mjs — registry view, test-file walking and header parsing for the
// telemetry test family. Never spawned as a check (the runner skips _-prefixed
// files in checks/; this lives at the implementation root).
//
// A TELEMETRY TEST is a test file identified by a `// Telemetry:` header, by a URN
// kind segment (-TELEMETRY- / -EVENT- / -METRIC-), or by *.telemetry.test.*
// colocation — the same identification tester.bun.telemetry-emit uses, plus the
// binding header this profile adds.
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, extname, sep } from "node:path";
import { loadTelemetryFiles, CONCRETE_URN } from "../../src/telemetry-plan.ts";

const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const DEFAULT_EXCLUDES = ["node_modules", "dist", "build", ".next", ".git", "_generated"];

function isExcluded(path, excludes) {
  const segs = path.split(sep);
  return excludes.some((ex) => segs.includes(ex) || path.includes(ex));
}

export function* walkTests(root, excludes) {
  let st;
  try { st = statSync(root); } catch { return; }
  if (st.isFile()) { if (TEST_RE.test(root)) yield root; return; }
  let names;
  try { names = readdirSync(root); } catch { return; }
  for (const name of names) {
    const full = join(root, name);
    if (isExcluded(full, excludes)) continue;
    let cst;
    try { cst = statSync(full); } catch { continue; }
    if (cst.isDirectory()) yield* walkTests(full, excludes);
    else if (TEST_RE.test(full)) yield full;
  }
}

const STRING_ON_LINE = /(["'`])(?:\\.|(?!\1)[^\n\\])*\1/g;
const TELEMETRY_HEADER = /^[ \t]*\/\/[ \t]*Telemetry:[ \t]*(\S+)[ \t]*$/;
const URN_HEADER = /^[ \t]*\/\/[ \t]*URN:[ \t]*(\S+)[ \t]*$/;
const ACCEPTANCE_HEADER = /^[ \t]*\/\/[ \t]*Acceptance:[ \t]*(\S+)[ \t]*$/;

/** The header facts a telemetry test is judged on: its URN, its acceptance binding, and every
 * Telemetry: reference (with line numbers, judged one per line). String literals are stripped
 * first: a header inside a string is not a header. */
export function parseTestHeader(text) {
  const lines = text.split("\n");
  const header = { urn: null, acceptance: null, telemetry: [] };
  for (let no = 0; no < lines.length; no++) {
    const line = lines[no].replace(STRING_ON_LINE, '""');
    const asTelemetry = TELEMETRY_HEADER.exec(line);
    if (asTelemetry) { header.telemetry.push({ no: no + 1, value: asTelemetry[1], raw: lines[no].trim() }); continue; }
    if (!header.urn) { const m = URN_HEADER.exec(line); if (m) { header.urn = { no: no + 1, value: m[1], raw: lines[no].trim() }; continue; } }
    if (!header.acceptance) { const m = ACCEPTANCE_HEADER.exec(line); if (m) header.acceptance = { no: no + 1, value: m[1], raw: lines[no].trim() }; }
  }
  return header;
}

const IS_TELEMETRY_URN = /-(?:TELEMETRY|EVENT|METRIC)-\d+/i;

/** Is this test file a telemetry test? */
export function isTelemetryTest(file, header) {
  if (header.telemetry.length) return true;
  if (/\.telemetry\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) return true;
  return Boolean(header.urn && IS_TELEMETRY_URN.test(header.urn.value));
}

export function readText(file) {
  try { return readFileSync(file, "utf8"); } catch { return null; }
}

let cache = null;
export async function registry() {
  if (cache) return cache;
  const roots = JSON.parse(process.env.ATDD_SCAN_ROOTS ?? "[]");
  const loaded = await Promise.all(roots.map((root) => loadTelemetryFiles(root)));
  const ids = new Set(), itemFileById = new Map(), timingById = new Map();
  const requiredIds = new Set(), decisions = new Map();
  for (const result of loaded) {
    for (const id of result.requiredIds) requiredIds.add(id);
    for (const [id, decision] of result.decisions) decisions.set(id, decision);
    for (const file of result.files) {
      if (!file.data || typeof file.data.id !== "string" || !file.data.id) continue;
      ids.add(file.data.id);
      itemFileById.set(file.data.id, file.file);
      timingById.set(file.data.id, Array.isArray(file.data.timing) ? file.data.timing.filter((t) => typeof t === "string") : []);
    }
  }
  cache = { adopted: loaded.some((result) => result.adopted), ids, itemFileById, timingById, requiredIds, decisions, concreteUrn: CONCRETE_URN };
  return cache;
}
