import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";
import { validatePlannerSchemas } from "../src/planner-schema-validator";
import { validateStaticPlannerConventions } from "../src/planner-validators";

// An interlocking's routes may be written as a compact list (`routes:` then `- route_id:` at column 0): the same YAML.
// The detectors once parsed it line by line, so a compact file had no routes and every route rule passed without
// judging anything (FWS, atdd-maintainer #G3aXIPPW1Mz5). Each dirty fixture, rewritten compactly, must report exactly
// what it reports as written.
const detectors = resolve(import.meta.dir, "../detectors");
const compact = (text: string) => { let inRoutes = false; return text.split("\n").map(line => { if (/^routes:/.test(line)) { inRoutes = true; return line; } if (/^\S/.test(line)) inRoutes = false; return inRoutes ? line.replace(/^ {2}/, "") : line; }).join("\n"); };
const found = async (detector: string, root: string) => (await runImplementation(detector, { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).map(v => `${v.rule_id} ${v.file.slice(root.length + 1)}:${v.line}`).sort();

for (const [detector, fixture] of [["bun_interlocking_coverage", "dirty"], ["bun_interlocking_binding", "dirty"]] as const) {
  test(`${detector}: a compact route list is judged exactly like an indented one`, async () => {
    const root = await mkdtemp(join(tmpdir(), "atdd-compact-"));
    try {
      await cp(join(detectors, detector, "fixtures", fixture), root, { recursive: true });
      const files = [...new Bun.Glob("**/_interlockings/*.yaml").scanSync(root)].map(path => join(root, path));
      expect(files.length).toBeGreaterThan(0);
      const indented = await found(detector, root);
      expect(indented.length).toBeGreaterThan(0);
      for (const file of files) await writeFile(file, compact(await readFile(file, "utf8")));
      expect(await readFile(files[0]!, "utf8")).toMatch(/^routes:\n- route_id:/m);
      expect(await found(detector, root)).toEqual(indented);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("a route whose train passes through a wagon with no source yet is pending; it is judged once the wagon has source", async () => {
  // FWS #ZJOYdwEqnvuP: 26 of 35 routes pass through wagons not built yet. Derived, not declared: nothing can park a route.
  const root = await mkdtemp(join(tmpdir(), "atdd-pending-"));
  try {
    await cp(join(detectors, "bun_interlocking_coverage", "fixtures", "dirty", "interlocking_route_coverage"), root, { recursive: true });
    await writeFile(join(root, "plan", "_trains", "match-resolution-timeout.yaml"), "train_id: train:match:match-resolution-timeout\nsequence:\n- step: 1\n  from: user:player\n  to: wagon:match-voting\n");
    // The repository keeps wagon code under the source root: another train's wagon is built there.
    await writeFile(join(root, "plan", "_trains", "match-resolution-standard.yaml"), "train_id: train:match:match-resolution-standard\nsequence:\n- step: 1\n  from: user:player\n  to: wagon:match-core\n");
    await mkdir(join(root, "src", "wagons", "match-core", "features", "core", "domain"), { recursive: true });
    await writeFile(join(root, "src", "wagons", "match-core", "features", "core", "domain", "core.ts"), "export const core = 1;\n");
    const routes = async () => (await found("bun_interlocking_coverage", root)).filter(line => line.startsWith("tester.bun.interlocking-route-coverage"));
    const pending = await routes();
    const built = async () => { await mkdir(join(root, "src", "wagons", "match-voting", "features", "vote", "domain"), { recursive: true }); await writeFile(join(root, "src", "wagons", "match-voting", "features", "vote", "domain", "vote.ts"), "export const vote = 1;\n"); return routes(); };
    const judged = await built();
    // The other route, whose train document is absent, is judged throughout; the pending one comes back once built.
    expect(judged.length).toBe(pending.length + 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("where no wagon has source under the source root, nothing is pending and every route is judged", async () => {
  // C1 #yPaL9lCipO9p: decision-os keeps wagon code outside src/wagons, and 0.10.18 read that as every wagon unbuilt, so
  // both route rules went silent. A repository that does not use the layout is judged exactly as before.
  const root = await mkdtemp(join(tmpdir(), "atdd-no-layout-"));
  try {
    await cp(join(detectors, "bun_interlocking_coverage", "fixtures", "dirty", "interlocking_route_coverage"), root, { recursive: true });
    const before = await found("bun_interlocking_coverage", root);
    await writeFile(join(root, "plan", "_trains", "match-resolution-timeout.yaml"), "train_id: train:match:match-resolution-timeout\nsequence:\n- step: 1\n  from: user:player\n  to: wagon:match-voting\n");
    await mkdir(join(root, "src", "db"), { recursive: true });
    await writeFile(join(root, "src", "db", "vote.ts"), "export const vote = 1;\n");
    expect((await found("bun_interlocking_coverage", root)).filter(line => line.startsWith("tester.bun.interlocking-route-coverage"))).toEqual(before.filter(line => line.startsWith("tester.bun.interlocking-route-coverage")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a wagon whose produced artifact Cargo-moving code names is built wherever its code lives, so its route is judged", async () => {
  // C1 #lVuJXXe3mM9E: one wagon built under src/wagons switched the whole repository to the layout, and every route through
  // a wagon coded elsewhere (decision-os: src/trains) went pending and silent. The wagon-contract rule's own evidence,
  // Cargo-moving code naming the artifact, marks such a wagon built.
  const root = await mkdtemp(join(tmpdir(), "atdd-mixed-layout-"));
  try {
    await cp(join(detectors, "bun_interlocking_coverage", "fixtures", "dirty", "interlocking_route_coverage"), root, { recursive: true });
    await writeFile(join(root, "plan", "_trains", "match-resolution-timeout.yaml"), "train_id: train:match:match-resolution-timeout\nsequence:\n- step: 1\n  from: user:player\n  to: wagon:match-voting\n");
    await writeFile(join(root, "plan", "_trains", "match-resolution-standard.yaml"), "train_id: train:match:match-resolution-standard\nsequence:\n- step: 1\n  from: user:player\n  to: wagon:match-core\n");
    await mkdir(join(root, "plan", "match-voting"), { recursive: true });
    await writeFile(join(root, "plan", "match-voting", "_match-voting.yaml"), "wagon: match-voting\nproduce:\n  - name: match:vote-cast\nconsume:\n  - name: match:ballot\n");
    await mkdir(join(root, "src", "wagons", "match-core", "features", "core", "domain"), { recursive: true });
    await writeFile(join(root, "src", "wagons", "match-core", "features", "core", "domain", "core.ts"), "export const core = 1;\n");
    const routes = async () => (await found("bun_interlocking_coverage", root)).filter(line => line.startsWith("tester.bun.interlocking-route-coverage"));
    const pending = await routes();
    // match-voting's code lives outside the layout, and moves its artifact through Cargo.
    await mkdir(join(root, "src", "trains"), { recursive: true });
    await writeFile(join(root, "src", "trains", "handlers.ts"), 'export const vote = (cargo: Cargo) => cargo.put("match:vote-cast", 1);\n');
    expect((await routes()).length).toBe(pending.length + 1);
    // Only a mention in a comment, or in a test, builds nothing.
    await writeFile(join(root, "src", "trains", "handlers.ts"), '// cargo.put("match:vote-cast")\nexport const vote = (cargo: Cargo) => cargo;\n');
    expect((await routes()).length).toBe(pending.length);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a train-sequence finding points at the train's own document, not at an unrelated test", async () => {
  // FWS #fqUGvWHn25mq: the finding was anchored at the first e2e file scanned, which exercises none of the trains named.
  const sequence = (await runImplementation("bun_interlocking_coverage", { scanRoots: [join(detectors, "bun_interlocking_coverage", "fixtures", "dirty")], excludes: ["node_modules", ".git", ".atdd"] }))
    .filter(v => v.rule_id === "tester.bun.interlocking-train-sequence-is-exercised");
  expect(sequence.length).toBeGreaterThan(0);
  for (const v of sequence) expect(v.file).toMatch(/^plan\/_trains\/train:match:match-resolution-\w+\.yaml$/);
});

test("a train-sequence finding is associated by exact train identity, never by a prefix of it", async () => {
  // A train id that is a prefix of another used to select the other's plan document (substring match), so the shorter
  // route was blamed on the longer train's file; two trains then collapsed onto one file and one fingerprint.
  const root = await mkdtemp(join(tmpdir(), "atdd-train-identity-"));
  try {
    const shorter = "train:decision-response:await-routing-authority";
    const longer = `${shorter}-again`;
    const trains = join(root, "plan", "_trains");
    await mkdir(join(trains, "_interlockings"), { recursive: true });
    await writeFile(join(trains, "_interlockings", "decision-response.yaml"),
      `interlocking_id: interlocking:decision-response\nroutes:\n  - route_id: await\n    train_id: ${shorter}\n    category: happy\n  - route_id: await-again\n    train_id: ${longer}\n    category: happy\n`);
    const shorterFile = join(trains, "z-shorter.yaml");
    const longerFile = join(trains, "a-longer-again.yaml");   // sorts first: a substring match reaches it before the exact file
    const doc = (id: string, sequence: boolean) => `train_id: ${id}\n${sequence ? "sequence:\n  - wagon:one\n  - wagon:two\n" : "wagons: []\n"}`;
    const sequence = async () => (await runImplementation("bun_interlocking_coverage", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] }))
      .filter(v => v.rule_id === "tester.bun.interlocking-train-sequence-is-exercised")
      .map(v => ({ file: v.file, train: /declared train "([^"]+)"/.exec(v.evidence)?.[1] }))
      .sort((a, b) => a.file.localeCompare(b.file));
    // Only the longer train declares a sequence: the shorter has none to exercise and must not borrow the longer's document.
    await writeFile(longerFile, doc(longer, true));
    await writeFile(shorterFile, doc(shorter, false));
    expect(await sequence()).toEqual([{ file: "plan/_trains/a-longer-again.yaml", train: longer }]);
    // Both declare one: each finding is anchored at its own exact document.
    await writeFile(shorterFile, doc(shorter, true));
    expect(await sequence()).toEqual([
      { file: "plan/_trains/a-longer-again.yaml", train: longer },
      { file: "plan/_trains/z-shorter.yaml", train: shorter },
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a route id covers its route only in a test of its own interlocking", async () => {
  // FWS #liu3vKZYAPXD: `refuse` is a route of two interlockings; a test of one used to cover the other with no test.
  const root = await mkdtemp(join(tmpdir(), "atdd-route-scope-"));
  try {
    const doc = (id: string) => `interlocking_id: interlocking:${id}\nroutes:\n  - route_id: refuse\n    train_id: train:${id}:refuse-${id}\n    category: error\n`;
    await mkdir(join(root, "plan", "_trains", "_interlockings"), { recursive: true });
    await writeFile(join(root, "plan", "_trains", "_interlockings", "alpha.yaml"), doc("alpha"));
    await writeFile(join(root, "plan", "_trains", "_interlockings", "beta.yaml"), doc("beta"));
    await mkdir(join(root, "e2e", "interlockings", "alpha"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "interlocking.ts"), "export class InterlockingRunner { resolveTrain() { return { routeId: 'refuse', trainId: 'train:alpha:refuse-alpha' }; } }\n");
    await writeFile(join(root, "src", "runner.ts"), "export class TrainRunner { constructor(_: string) {} execute() { return {}; } }\n");
    await writeFile(join(root, "e2e", "interlockings", "alpha", "refuse.routes.test.ts"), 'import { expect, test } from "bun:test";\nimport { InterlockingRunner } from "../../../src/interlocking";\nimport { TrainRunner } from "../../../src/runner";\ntest("interlocking:alpha refuse", () => { const resolution = new InterlockingRunner().resolveTrain("refuse", {}); const result = new TrainRunner(resolution.trainId).execute({}); expect(resolution.routeId).toBe("refuse"); expect(result).toBeDefined(); });\n');
    const coverage = (await runImplementation("bun_interlocking_coverage", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).filter(v => v.rule_id === "tester.bun.interlocking-route-coverage");
    expect(coverage.map(v => v.file)).toEqual([expect.stringContaining("beta.yaml")]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("only a test declared Phase: SMOKE covers an exposed Station Master action", async () => {
  // FWS #TzSCGS5ajYhP: a local E2E naming the action beside the runners cleared the rule, though it is not a smoke.
  const root = await mkdtemp(join(tmpdir(), "atdd-smoke-phase-"));
  try {
    await cp(join(detectors, "bun_interlocking_coverage", "fixtures", "clean", "interlocking_smoke_coverage"), root, { recursive: true });
    const smoke = join(root, "e2e", "smoke", "resolve-match.smoke.test.ts");
    const rule = async () => (await runImplementation("bun_interlocking_coverage", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).filter(v => v.rule_id === "tester.bun.interlocking-smoke-coverage-for-station-master");
    expect(await rule()).toEqual([]);
    await writeFile(smoke, (await readFile(smoke, "utf8")).replace("// Phase: SMOKE\n", "// Phase: E2E\n"));
    expect((await rule()).length).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an E2E that drives the production Station Master uses the runners it composes", async () => {
  // FWS #sEW3F9b49iA7: an HTTP E2E through src/server.ts was flagged unless it named a runner symbol it does not need.
  const root = await mkdtemp(join(tmpdir(), "atdd-station-runner-"));
  try {
    await cp(join(detectors, "bun_interlocking_coverage", "fixtures", "clean", "interlocking_production_runner"), root, { recursive: true });
    const test_ = join(root, "e2e", "interlockings", "match-resolution", "via-station.test.ts");
    await writeFile(test_, 'import { expect, test } from "bun:test";\nimport { dispatch } from "../../../src/server";\ntest("nominal-all-voted", async () => { const result = await dispatch("resolve_match", {}); expect(result).toBeDefined(); });\n');
    const flagged = async () => (await runImplementation("bun_interlocking_coverage", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).filter(v => v.rule_id === "tester.bun.interlocking-production-runner-used" && v.file.endsWith("via-station.test.ts"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "server.ts"), "export const dispatch = async (_action: string, _inputs: object) => ({});\n");
    expect((await flagged()).length).toBe(1);   // a Station Master that composes no runners proves nothing
    await writeFile(join(root, "src", "server.ts"), 'import { InterlockingRunner } from "./trains/interlocking";\nimport { TrainRunner } from "./trains/runner";\nconst runner = new InterlockingRunner();\nexport const dispatch = (action: string, inputs: object) => { const resolution = runner.resolveTrain(action, inputs, {}); return new TrainRunner(resolution.trainId).execute({}); };\n');
    expect(await flagged()).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a wagon contract is judged only once some train carries the wagon", async () => {
  // S4 #qSWeDfXJVXcv: wagon B is implemented but composed into a train only in a later tranche, so no Cargo carries it.
  const root = await mkdtemp(join(tmpdir(), "atdd-carried-"));
  try {
    const wagon = (id: string, artifact: string) => `wagon: ${id}\nproduce:\n  - name: ${artifact}\nconsume: []\n`;
    await mkdir(join(root, "plan", "a"), { recursive: true }); await mkdir(join(root, "plan", "b"), { recursive: true }); await mkdir(join(root, "plan", "_trains"), { recursive: true });
    await writeFile(join(root, "plan", "a", "_a.yaml"), wagon("a", "x:a"));
    await writeFile(join(root, "plan", "b", "_b.yaml"), wagon("b", "x:b"));
    await writeFile(join(root, "plan", "_trains", "t-a.yaml"), "train_id: train:x:t-a\nsequence:\n- step: 1\n  from: user:u\n  to: wagon:a\n");
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "src", "trains"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), 'export class Cargo {}\nexport function runA(cargo: { put(k: string, v: unknown): void }) { cargo.put("x:a", 1); }\n');
    await writeFile(join(root, "src", "trains", "runner.ts"), 'import { runA } from "../a";\nexport function runTrain(step: string, cargo: Cargo) { if (step === "a") return runA(cargo); }\n');
    await writeFile(join(root, "src", "b.ts"), "export const backfill = () => 1;\n");
    const contract = async () => (await runImplementation("bun_interlocking_infrastructure", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).filter(v => v.rule_id === "coder.bun.wagon-honours-its-contract");
    expect(await contract()).toEqual([]);
    await writeFile(join(root, "plan", "_trains", "t-b.yaml"), "train_id: train:x:t-b\nsequence:\n- step: 1\n  from: wagon:a\n  to: wagon:b\n");
    expect((await contract()).map(v => v.evidence)).toEqual([expect.stringContaining('"x:b"')]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("artifact constants outside the executed wagon do not honour its Cargo contract", async () => {
  // A lexical repository-wide match used to accept this: constants named the wagon's
  // artifacts, while an unrelated helper moved different Cargo. Neither action is
  // the carried wagon's executable contract.
  const root = await mkdtemp(join(tmpdir(), "atdd-wagon-contract-constants-"));
  try {
    await mkdir(join(root, "plan", "orders"), { recursive: true });
    await mkdir(join(root, "plan", "_trains"), { recursive: true });
    await mkdir(join(root, "src", "orders"), { recursive: true });
    await mkdir(join(root, "src", "trains"), { recursive: true });
    await writeFile(join(root, "plan", "orders", "_orders.yaml"), "wagon: confirm-order\nproduce:\n  - name: orders:confirmed-order\nconsume:\n  - name: orders:priced-basket\n");
    await writeFile(join(root, "plan", "_trains", "checkout.yaml"), "train_id: train:orders:checkout\nsequence:\n- step: 1\n  from: customer:active\n  to: wagon:confirm-order\n");
    await writeFile(join(root, "src", "orders", "artifacts.ts"), 'export const CONSUMES = "orders:priced-basket";\nexport const PRODUCES = "orders:confirmed-order";\nexport class Cargo {}\n');
    await writeFile(join(root, "src", "trains", "unrelated.ts"), 'export const audit = (cargo: Cargo) => { cargo.get("audit:entry"); cargo.put("audit:record", true); };\n');
    const contract = async () => (await runImplementation("bun_interlocking_infrastructure", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).filter(v => v.rule_id === "coder.bun.wagon-honours-its-contract");
    expect((await contract()).map(v => v.evidence)).toEqual([
      expect.stringContaining('"orders:confirmed-order"'),
      expect.stringContaining('"orders:priced-basket"'),
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// A wagon may read its input from, or write its output to, a declared platform service
// (`from: system:<service>` / `to: system:<service>`) rather than Cargo. Decision OS's storage-read and
// storage-write wagons are this shape: the contract check used to read only artifact names and so
// demanded a Cargo.get / Cargo.put the wagon never performs (M-20261011T125547Z, task
// atdd-bun/wagon-contract-system-side-io). Only the declared system side is exempt from the Cargo move;
// the wagon must still be carried and bound to a train step, and a system: label cannot relabel an
// artifact another wagon puts into Cargo.

const WAGON_CONTRACT_RULE = "coder.bun.wagon-honours-its-contract";

async function writeAt(root: string, path: string, content: string) {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

const decisionWagon = (consume: string, produce: string) =>
  `wagon: route-model\nproduce:\n${produce}consume:\n${consume}`;
const systemConsume = "  - name: evidence:admission.committed\n    from: system:canonical-store\n";
const systemProduce = "  - name: governance:model-routing.attempt\n    contract: null\n    telemetry: null\n    to: system:canonical-store\n";

// The handler reads and writes storage, never Cargo.
const storageHandler =
  'export async function recordAttempt(cargo: Cargo, store: { read(k: string): Promise<unknown>; write(k: string, v: unknown): Promise<void> }) {\n' +
  '  const admission = await store.read("evidence:admission.committed");\n' +
  '  await store.write("governance:model-routing.attempt", { admission });\n' +
  "}\n";
const boundRunner =
  'import { recordAttempt } from "../wagons/route-model/handler";\n' +
  "export class Cargo {}\n" +
  'export function runTrain(step: string, cargo: Cargo, store: any) { if (step === "route-model") return recordAttempt(cargo, store); }\n';
const train = "train_id: train:governance:route-model\nsequence:\n- step: 1\n  from: system:canonical-store\n  to: wagon:route-model\n";

async function withDecision(files: Record<string, string>, assert: (evidence: string[]) => void | Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "atdd-wagon-system-io-"));
  try {
    const base: Record<string, string> = {
      "plan/route-model/_route-model.yaml": decisionWagon(systemConsume, systemProduce),
      "plan/_trains/route-model.yaml": train,
      "src/wagons/route-model/handler.ts": storageHandler,
      "src/trains/runner.ts": boundRunner,
      ...files,
    };
    for (const [path, content] of Object.entries(base)) await writeAt(root, path, content);
    const violations = await runImplementation("bun_interlocking_infrastructure", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] });
    await assert(violations.filter(v => v.rule_id === WAGON_CONTRACT_RULE).map(v => v.evidence));
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("a carried wagon that consumes from system: and produces to system: is not required to move Cargo", async () => {
  await withDecision({}, evidence => expect(evidence).toEqual([]));
});

test("a Cargo-sourced consume without a Cargo.get still fires beside a system: produce", async () => {
  await withDecision({
    "plan/route-model/_route-model.yaml": decisionWagon("  - name: evidence:admission.committed\n    from: wagon:admit\n", systemProduce),
  }, evidence => expect(evidence).toEqual([expect.stringContaining('consumes "evidence:admission.committed"')]));
});

test("a consume with no declared source and no Cargo.get still fires", async () => {
  await withDecision({
    "plan/route-model/_route-model.yaml": decisionWagon("  - name: evidence:admission.committed\n", systemProduce),
  }, evidence => expect(evidence).toEqual([expect.stringContaining('consumes "evidence:admission.committed"')]));
});

test("a produce with no `to` and no Cargo.put still fires beside a system: consume", async () => {
  await withDecision({
    "plan/route-model/_route-model.yaml": decisionWagon(systemConsume, "  - name: governance:model-routing.attempt\n    contract: null\n    telemetry: null\n"),
  }, evidence => expect(evidence).toEqual([expect.stringContaining('produces "governance:model-routing.attempt"')]));
});

test("a system: label on an artifact another wagon produces into Cargo is refused", async () => {
  await withDecision({
    "plan/admit/_admit.yaml": "wagon: admit\nproduce:\n  - name: evidence:admission.committed\n    contract: null\n    telemetry: null\nconsume: []\n",
  }, evidence => expect(evidence).toEqual([expect.stringMatching(/"evidence:admission\.committed".*system:canonical-store.*wagon:admit/)]));
});

test("a system: label on an artifact another wagon writes to system: is not a relabelled Cargo move", async () => {
  await withDecision({
    "plan/admit/_admit.yaml": "wagon: admit\nproduce:\n  - name: evidence:admission.committed\n    contract: null\n    telemetry: null\n    to: system:canonical-store\nconsume: []\n",
  }, evidence => expect(evidence).toEqual([]));
});

test("a system:-declared wagon whose handler no train step reaches still fires", async () => {
  await withDecision({
    "src/trains/runner.ts": 'export class Cargo {}\nexport function runTrain(step: string, cargo: Cargo) { return step; }\n',
  }, evidence => expect(evidence).toEqual([
    expect.stringContaining('produces "governance:model-routing.attempt"'),
    expect.stringContaining('consumes "evidence:admission.committed"'),
  ]));
});

const plannerWagon = (to: string) =>
  `wagon: route-model\nurn: wagon:route-model\ndescription: Records a model routing attempt.\nsubject: agent:router\ncontext: test\naction: record\ngoal: route\noutcome: recorded\n` +
  `produce:\n  - name: governance:model-routing.attempt\n    contract: null\n    telemetry: null\n    to: ${to}\n` +
  `consume:\n  - name: evidence:admission.committed\n    from: system:canonical-store\nwmbt:\n  total: 1\n`;

async function withPlannerWagon(to: string, assert: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "atdd-wagon-system-io-plan-"));
  try { await writeAt(root, "plan/route-model/_route-model.yaml", plannerWagon(to)); await assert(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

const destinationFindings = async (root: string) => [
  ...(await validatePlannerSchemas(root)).filter(f => f.evidence.includes("/produce/0/to")).map(f => f.evidence),
  ...(await validateStaticPlannerConventions(root)).filter(f => f.evidence.includes("invalid destination")).map(f => f.evidence),
];

test("the planner accepts a produce destination of system:<service>", async () => {
  await withPlannerWagon("system:canonical-store", async root => expect(await destinationFindings(root)).toEqual([]));
});

test("the planner still refuses a free-text or empty system produce destination", async () => {
  for (const to of ["canonical-store", "system:", "system:Canonical Store"]) {
    await withPlannerWagon(JSON.stringify(to), async root => {
      const evidence = await destinationFindings(root);
      expect(evidence.some(e => e.includes("/produce/0/to"))).toBe(true);
      expect(evidence.some(e => e.includes("invalid destination"))).toBe(true);
    });
  }
});

// A produce written to system: owes no Cargo.put, so it cannot carry an artifact another wagon still reads
// through Cargo: the producer's Cargo obligation would vanish while the consumer's expectation stayed.
const auditWagon = (from: string) =>
  `wagon: audit\nproduce:\n  - name: audit:entry\n    contract: null\n    telemetry: null\nconsume:\n  - name: governance:model-routing.attempt\n${from ? `    from: ${from}\n` : ""}`;

test("a system: produce of an artifact another wagon consumes through Cargo is refused", async () => {
  for (const from of ["wagon:route-model", ""]) {
    await withDecision({ "plan/audit/_audit.yaml": auditWagon(from) },
      evidence => expect(evidence).toEqual([expect.stringMatching(/"governance:model-routing\.attempt".*system:canonical-store.*wagon:audit/)]));
  }
});

test("a system: produce of an artifact another wagon also reads from system: is not a relabelled Cargo move", async () => {
  await withDecision({ "plan/audit/_audit.yaml": auditWagon("system:canonical-store") }, evidence => expect(evidence).toEqual([]));
});

const coherenceFindings = async (to: string) => {
  const root = await mkdtemp(join(tmpdir(), "atdd-wagon-system-io-coherence-"));
  try {
    await writeAt(root, "plan/route-model/_route-model.yaml", plannerWagon(to).replace("contract: null", "contract: contract:governance:model-routing.attempt"));
    await writeAt(root, "contracts/_contracts.yaml", "contracts:\n  - identity: governance:model-routing.attempt\n    path: contracts/governance/model-routing/attempt.schema.json\n    theme: governance\n    producers: [wagon:route-model]\n    consumers: []\n");
    await writeAt(root, "contracts/governance/model-routing/attempt.schema.json", '{"type":"object"}\n');
    return (await validateStaticPlannerConventions(root)).filter(f => f.evidence.includes("no cross-wagon consumer")).map(f => f.evidence);
  } finally { await rm(root, { recursive: true, force: true }); }
};

test("a contracted produce written to system:<service> with no cross-wagon consumer is registry-coherent", async () => {
  expect(await coherenceFindings("system:canonical-store")).toEqual([]);
});

test("a contracted produce kept internal with no cross-wagon consumer is still incoherent", async () => {
  expect(await coherenceFindings("internal")).toEqual([expect.stringContaining("is not marked to: external")]);
});
