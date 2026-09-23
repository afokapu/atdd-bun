// Shared model for the htmx_e2e_detector family: browser (Playwright) specs and the plan they cover.
//
// A BROWSER SPEC is a `*.e2e.ts` file. It is named that way, not `*.spec.ts`, because `bun test`
// collects every `*.spec.*` and `*.test.*` file and would try to run a Playwright spec with the
// wrong runner. A JOURNEY SPEC is a browser spec, or any test file whose header comments carry a
// journey marker (`// Train:`, `// Journey:`, `// URN: test:train|journey:`), so a misnamed one is still judged.
//
// A journey spec binds to ONE plan subject through its header, and every test URN it carries
// must agree with that binding:
//
//   // Train: train:orders:place-order          or   // Journey: journey:buy
//   // Layer: assembly
//   test:train:orders:place-order:E2E-001-places-an-order   (harness E2E | SMOKE | A11Y | VIS | RESP)
import { basename, join, resolve } from "node:path";
import { walk, readText, maskLiteralsAndComments } from "../../../lib/scan.mjs";
import { loadPlan } from "../../../src/planner-kernel.ts";

export const TRAIN_ID = /^train:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
export const JOURNEY_ID = /^journey:[a-z][a-z0-9-]*$/;
export const HARNESSES = ["E2E", "SMOKE", "A11Y", "VIS", "RESP"];
const URN_STRICT = /^test:(train:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*|journey:[a-z][a-z0-9-]*):(E2E|SMOKE|A11Y|VIS|RESP)-\d{3}-[a-z0-9][a-z0-9-]*$/;
const URN_CANDIDATE = /test:(?:train|journey):[A-Za-z0-9:_-]+/g;
const SPEC_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);
const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
export const E2E_RE = /\.e2e\.[cm]?[jt]sx?$/;

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
  const bindingCount = [...text.matchAll(/^[ \t]*\/\/[ \t]*(Train|Journey):/gm)].length;
  return {
    file, text, binding, bindingCount, urns, harnesses,
    layer: header(text, "Layer"),
    acceptance: text.match(/^[ \t]*\/\/[ \t]*(Acceptance|WMBT):[ \t]*\S/m),
    playwright: /from\s+["']@playwright\/test["']/.test(text),
    // A spec declares tests; a config (`defineConfig`) or a fixture module (`base.extend`) only imports the runner.
    declaresTests: !/(^|[\\/])playwright\.config\.[cm]?[jt]s$/.test(file) && /(^|[^.\w])test(\.(describe|only|skip|fixme|fail|slow|step))?\s*\(/m.test(maskLiteralsAndComments(text)),
    e2eNamed: E2E_RE.test(file),
    // Outside *.e2e.ts only HEADER comments mark a journey spec; a unit test that merely mentions a
    // journey URN in a string is not one.
    journeyMarked: Boolean(train || journey) || /^[ \t]*\/\/[ \t]*URN:[ \t]*test:(train|journey):/m.test(text),
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
  // A train is human-facing when a person takes part in it; only those have a screen a browser spec can drive.
  const refs = (a) => [...(Array.isArray(a.data.participants) ? a.data.participants : []), ...(Array.isArray(a.data.sequence) ? a.data.sequence.flatMap((s) => [s?.from, s?.to]) : [])].map(String);
  // Staged activation (src/lifecycle.ts): a planned train owes no browser spec yet.
  const humanTrains = new Set(trainArtifacts.filter((a) => a.data.status !== "planned" && refs(a).some((r) => r.startsWith("user:"))).map((a) => a.id));
  const interlockings = graph.artifacts.filter((a) => a.kind === "interlocking");
  const routed = new Set(interlockings.flatMap((il) => (Array.isArray(il.data.routes) ? il.data.routes : []).map((r) => String(r?.train_id ?? ""))).filter(Boolean));
  // A journey has a browser surface unless its entrypoint declares surfaces that exclude `frontend`.
  const frontend = (surfaces) => !Array.isArray(surfaces) || surfaces.map(String).includes("frontend");
  const journeys = graph.artifacts.filter((a) => a.kind === "journey").map((a) => ({ id: a.id, file: a.file, exposed: a.data?.entrypoint?.exposed === true, frontend: frontend(a.data?.entrypoint?.surfaces) }));
  return { trains, trainFiles, humanTrains, routed, journeys: journeys.map((j) => ({ ...j, path: join(root, j.file) })), journeyIds: new Set(journeys.map((j) => j.id)), hasPlan: trains.size > 0 || journeys.length > 0 };
}

export { frontendConfig, DEFAULT_VIEWPORTS, DEFAULT_BREAKPOINTS } from "../../../lib/frontend.mjs";

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
