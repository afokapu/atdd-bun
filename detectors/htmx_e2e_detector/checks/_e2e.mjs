// Shared model for the htmx_e2e_detector family: browser (Playwright) specs and the plan they cover.
//
// A BROWSER SPEC is a `*.e2e.ts` file. It is named that way, not `*.spec.ts`, because `bun test`
// collects every `*.spec.*` and `*.test.*` file and would try to run a Playwright spec with the
// wrong runner. A JOURNEY SPEC is a browser spec, or any test file carrying a journey marker
// (`// Train:`, `// Journey:`, `test:train:`, `test:journey:`), so a misnamed one is still judged.
//
// A journey spec binds to ONE plan subject through its header, and every test URN it carries
// must agree with that binding:
//
//   // Train: train:orders:place-order          or   // Journey: journey:buy
//   // Layer: assembly
//   test:train:orders:place-order:E2E-001-places-an-order   (harness E2E | SMOKE | A11Y | VIS | RESP)
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { walk, readText } from "../../../lib/scan.mjs";
import { loadPlan } from "../../../src/planner-kernel.ts";

export const TRAIN_ID = /^train:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
export const JOURNEY_ID = /^journey:[a-z][a-z0-9-]*$/;
export const HARNESSES = ["E2E", "SMOKE", "A11Y", "VIS", "RESP"];
const URN_STRICT = /^test:(train:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*|journey:[a-z][a-z0-9-]*):(E2E|SMOKE|A11Y|VIS|RESP)-\d{3}-[a-z0-9][a-z0-9-]*$/;
const URN_CANDIDATE = /test:(?:train|journey):[A-Za-z0-9:_-]+/g;
const SPEC_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);
const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
export const E2E_RE = /\.e2e\.[cm]?[jt]sx?$/;
export const DEFAULT_VIEWPORTS = [375, 768, 1280];
export const DEFAULT_BREAKPOINTS = [480, 768, 1024, 1280];

const header = (text, name) => { const m = text.match(new RegExp(`^[ \\t]*//[ \\t]*${name}:[ \\t]*(\\S+)[ \\t]*$`, "m")); return m ? { value: m[1], line: lineOf(text, m.index) } : null; };
export const lineOf = (text, index) => text.slice(0, index).split("\n").length;
export const firstLine = (text) => (text.split(/\r?\n/)[0] || "").trim();

/** Everything a check needs to know about one test file. */
export function parseSpec(file, text) {
  const train = header(text, "Train"), journey = header(text, "Journey");
  const urns = [...text.matchAll(URN_CANDIDATE)].map((m) => ({ urn: m[0], index: m.index, valid: URN_STRICT.test(m[0]) }));
  const harnesses = new Set(urns.filter((u) => u.valid).map((u) => u.urn.split(":").at(-1).split("-")[0]));
  const name = basename(file).toLowerCase();
  if (/(^|[.-])a11y([.-]|$)/.test(name)) harnesses.add("A11Y");
  if (/(^|[.-])(visual|vis)([.-]|$)/.test(name)) harnesses.add("VIS");
  if (/(^|[.-])(responsive|resp)([.-]|$)/.test(name)) harnesses.add("RESP");
  if (/(^|[.-])smoke([.-]|$)/.test(name)) harnesses.add("SMOKE");
  const binding = train ? { kind: "train", id: train.value, line: train.line } : journey ? { kind: "journey", id: journey.value, line: journey.line } : null;
  return {
    file, text, binding, bothBindings: Boolean(train && journey), urns, harnesses,
    layer: header(text, "Layer"),
    acceptance: text.match(/^[ \t]*\/\/[ \t]*(Acceptance|WMBT):[ \t]*\S/m),
    playwright: /from\s+["']@playwright\/test["']/.test(text),
    e2eNamed: E2E_RE.test(file),
    journeyMarked: Boolean(train || journey) || urns.length > 0,
  };
}

/** Every file a check should look at: browser specs, test files, and anything importing Playwright. */
export function collectSpecs(roots, excludes) {
  const out = new Map();
  for (const root of roots) for (const file of walk(root, excludes, SPEC_EXT, true)) {
    if (out.has(resolve(file))) continue;
    const text = readText(file); if (text === null) continue;
    if (E2E_RE.test(file) || TEST_RE.test(file) || /@playwright\/test/.test(text)) out.set(resolve(file), parseSpec(file, text));
  }
  return [...out.values()];
}

export const isJourneySpec = (spec) => spec.e2eNamed || spec.journeyMarked;

/** The plan subjects a spec can bind to, read with the package's own loader. */
export async function planOf(root) {
  const graph = await loadPlan(root);
  const trainArtifacts = graph.artifacts.filter((a) => a.kind === "train"), trains = new Set(trainArtifacts.map((a) => a.id));
  const trainFiles = new Map(trainArtifacts.map((a) => [a.id, join(root, a.file)]));
  const interlockings = graph.artifacts.filter((a) => a.kind === "interlocking");
  const routed = new Set(interlockings.flatMap((il) => (Array.isArray(il.data.routes) ? il.data.routes : []).map((r) => String(r?.train_id ?? ""))).filter(Boolean));
  const journeys = graph.artifacts.filter((a) => a.kind === "journey").map((a) => ({ id: a.id, file: a.file, exposed: a.data?.entrypoint?.exposed === true }));
  return { trains, trainFiles, routed, journeys: journeys.map((j) => ({ ...j, path: join(root, j.file) })), journeyIds: new Set(journeys.map((j) => j.id)), hasPlan: trains.size > 0 || journeys.length > 0 };
}

/** Viewports and breakpoints declared in atdd-bun.yaml under `frontend:`, else the defaults. */
export function frontendConfig(root) {
  let data = {};
  try { data = Bun.YAML.parse(readFileSync(join(root, "atdd-bun.yaml"), "utf8")) ?? {}; } catch {}
  const numbers = (value, fallback) => (Array.isArray(value) && value.length && value.every((v) => Number.isInteger(v) && v > 0) ? [...value].sort((a, b) => a - b) : fallback);
  return { viewports: numbers(data?.frontend?.viewports, DEFAULT_VIEWPORTS), breakpoints: numbers(data?.frontend?.breakpoints, DEFAULT_BREAKPOINTS) };
}

/** Run one check over every scan root: `judge(root, specs, plan, report)`. */
export async function runCheck(tag, judge) {
  const { readRoots, readExcludes, emit } = await import("../../../lib/scan.mjs");
  const violations = [];
  for (const root of readRoots()) {
    const report = (rule_id, file, line, evidence, source_line = "") => violations.push({ rule_id, file, line, col: 1, evidence, source_line });
    await judge(resolve(root), collectSpecs([root], readExcludes()), await planOf(resolve(root)), report);
  }
  process.stderr.write(`bun-detector[${tag}]: ${violations.length} violation(s)\n`);
  emit(violations);
}
