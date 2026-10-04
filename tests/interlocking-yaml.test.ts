import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";

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

test("a route id covers its route only in a test of its own interlocking", async () => {
  // FWS #liu3vKZYAPXD: `refuse` is a route of two interlockings; a test of one used to cover the other with no test.
  const root = await mkdtemp(join(tmpdir(), "atdd-route-scope-"));
  try {
    const doc = (id: string) => `interlocking_id: interlocking:${id}\nroutes:\n  - route_id: refuse\n    train_id: train:${id}:refuse-${id}\n    category: error\n`;
    await mkdir(join(root, "plan", "_trains", "_interlockings"), { recursive: true });
    await writeFile(join(root, "plan", "_trains", "_interlockings", "alpha.yaml"), doc("alpha"));
    await writeFile(join(root, "plan", "_trains", "_interlockings", "beta.yaml"), doc("beta"));
    await mkdir(join(root, "e2e", "interlockings", "alpha"), { recursive: true });
    await writeFile(join(root, "e2e", "interlockings", "alpha", "refuse.routes.test.ts"), 'import { test } from "bun:test";\ntest("interlocking:alpha refuse", () => {});\n');
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
    await writeFile(test_, 'import { expect, test } from "bun:test";\nimport { dispatch } from "../../../src/server";\ntest("nominal-all-voted", async () => expect(await dispatch("resolve_match", {})).toBeDefined());\n');
    const flagged = async () => (await runImplementation("bun_interlocking_coverage", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).filter(v => v.rule_id === "tester.bun.interlocking-production-runner-used" && v.file.endsWith("via-station.test.ts"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "server.ts"), "export const dispatch = async (_action: string, _inputs: object) => ({});\n");
    expect((await flagged()).length).toBe(1);   // a Station Master that composes no runners proves nothing
    await writeFile(join(root, "src", "server.ts"), 'import { InterlockingRunner } from "./trains/interlocking";\nimport { TrainRunner } from "./trains/runner";\nconst runner = new InterlockingRunner(new TrainRunner());\nexport const dispatch = (action: string, inputs: object) => runner.resolveTrain(action, inputs, {});\n');
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
    await writeFile(join(root, "src", "a.ts"), 'export function runA(cargo: { put(k: string, v: unknown): void }) { cargo.put("x:a", 1); }\n');
    await writeFile(join(root, "src", "b.ts"), "export const backfill = () => 1;\n");
    const contract = async () => (await runImplementation("bun_interlocking_infrastructure", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).filter(v => v.rule_id === "coder.bun.wagon-honours-its-contract");
    expect(await contract()).toEqual([]);
    await writeFile(join(root, "plan", "_trains", "t-b.yaml"), "train_id: train:x:t-b\nsequence:\n- step: 1\n  from: wagon:a\n  to: wagon:b\n");
    expect((await contract()).map(v => v.evidence)).toEqual([expect.stringContaining('"x:b"')]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
