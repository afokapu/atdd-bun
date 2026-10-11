import { expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";

// Traceability closure holes: each case is a way a test or source file could look traced while it is not.
const repo = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), "atdd-trace-"));
  for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
  return root;
};
const findings = async (root: string) => (await runImplementation("atdd_traceability_closure", { scanRoots: [root], excludes: ["node_modules", ".git"] }))
  .map(v => `${v.rule_id} ${v.file.startsWith(root) ? v.file.slice(root.length + 1) : v.file}`).sort();
const WMBT = "urn: wmbt:orders:E001\nacceptances:\n  - identity:\n      urn: acc:orders:E001-UNIT-001\n";
const BOUND = "// URN: test:orders:x:E001-UNIT-001\n// Acceptance: acc:orders:E001-UNIT-001\n";

test("every binding header must resolve, not only the first", async () => {
  const root = await repo({
    "plan/orders/E001.yaml": WMBT,
    "test/two.test.ts": `${BOUND}// Train: train:orders:does-not-exist\n`,
    "test/bad.test.ts": "// URN: test:orders:x:E001-UNIT-002\n// Acceptance: acc:orders:E001-UNIT-001\n// WMBT: not-a-wmbt\n",
  });
  expect(await findings(root)).toEqual(["traceability.test.binding-resolves test/bad.test.ts", "traceability.test.binding-resolves test/two.test.ts"]);
  // Identical headers are each reported at their own line.
  const twice = await repo({ "plan/orders/E001.yaml": WMBT, "test/twice.test.ts": `${BOUND}// Train: train:orders:nowhere\n// Train: train:orders:nowhere\n` });
  expect((await runImplementation("atdd_traceability_closure", { scanRoots: [twice], excludes: [] })).map(v => v.line)).toEqual([3, 4]);
});

test("duplicate test URNs retain every independently declared acceptance binding", async () => {
  const root = await repo({
    "plan/orders/one.yaml": "acceptances:\n  - identity:\n      urn: acc:orders:ONE\n",
    "plan/orders/two.yaml": "acceptances:\n  - identity:\n      urn: acc:orders:TWO\n",
    "test/one.test.ts": "// URN: test:orders:shared:SMOKE-001\n// Acceptance: acc:orders:ONE\n",
    "test/two.test.ts": "// URN: test:orders:shared:SMOKE-001\n// Acceptance: acc:orders:TWO\n",
  });
  expect(await findings(root)).toEqual([]);
});

test("an acceptance without a test is reported where it is declared", async () => {
  const root = await repo({ "plan/orders/E001.yaml": WMBT });
  const [finding] = await runImplementation("atdd_traceability_closure", { scanRoots: [root], excludes: [] });
  expect([finding.rule_id, finding.file, finding.line]).toEqual(["traceability.plan.executable-acceptance-has-test", join(root, "plan/orders/E001.yaml"), 4]);
  // Also in YAML flow style, with the key quoted or not.
  for (const identity of ["{ urn: acc:orders:E001-UNIT-001 }", '{ "urn": acc:orders:E001-UNIT-001 }']) {
    const flow = await repo({ "plan/orders/E001.yaml": `urn: wmbt:orders:E001\nacceptances:\n  - identity: ${identity}\n` });
    const [inline] = await runImplementation("atdd_traceability_closure", { scanRoots: [flow], excludes: [] });
    expect([inline.file, inline.line], identity).toEqual([join(flow, "plan/orders/E001.yaml"), 3]);
  }
});

test("a plan at the repository root (plan_root: .) is judged", async () => {
  for (const planRoot of [".", "./"]) {
    const root = await repo({ "atdd-bun.yaml": `topology:\n  plan_root: ${planRoot}\n`, "E001.yaml": WMBT });
    expect(await findings(root), planRoot).toEqual(["traceability.plan.executable-acceptance-has-test E001.yaml"]);
  }
});

test("a Tested-By entry counts only under a Tested-By header, and every entry is judged", async () => {
  const root = await repo({
    "plan/orders/E001.yaml": WMBT, "test/one.test.ts": BOUND,
    "src/stray.ts": "// URN: component:orders:a:Stray:backend:domain\n// - test:orders:x:E001-UNIT-001\nexport const s = 1;\n",
    "src/mixed.ts": "// URN: component:orders:a:Mixed:backend:domain\n// Tested-By:\n// - test:orders:x:E001-UNIT-001\n// - not-a-test\nexport const m = 1;\n",
    "src/good.ts": "// URN: component:orders:a:Good:backend:domain\n// Tested-By:\n// - test:orders:x:E001-UNIT-001\nexport const g = 1;\n",
    "src/twice.ts": "// URN: component:orders:a:Twice:backend:domain\n// Tested-By:\n// - test:orders:x:E001-UNIT-001\n// Runtime: bun\n// Tested-By:\n// - not-a-test\nexport const t = 1;\n",
  });
  expect(await findings(root)).toEqual(["traceability.source.tested-by-present src/stray.ts", "traceability.source.tested-by-resolves src/mixed.ts", "traceability.source.tested-by-resolves src/twice.ts"]);
});

// DOS residual detector compatibility: truthful DOS shapes must stay green while paired mutants stay red.
const excludes = ["node_modules", ".git", ".atdd"];
const withRoot = async (name: string, work: (root: string) => Promise<void>) => {
  const root = await mkdtemp(join(tmpdir(), `atdd-dos-${name}-`));
  try {
    await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

// DOS's e2e support helper is live only through Bun test entrypoints, not production imports.
test("dead-code reachability retains test-only support and rejects its disconnected mutant", async () => {
  await withRoot("support-reachability", async (root) => {
    await mkdir(join(root, "e2e", "smoke"), { recursive: true });
    await writeFile(join(root, "server.ts"), "export const station = true;\n");
    await writeFile(join(root, "e2e", "support.ts"), "export const trainContext = () => ({ seed: {} });\n");
    const smoke = join(root, "e2e", "smoke", "station.test.ts");
    await writeFile(smoke, `import { test } from "bun:test";
import { trainContext } from "../support.ts";
test("station support", () => trainContext());
`);

    const findings = await runImplementation("bun_ts_metrics_detector", { scanRoots: [root], excludes });
    expect(findings.filter(item => item.rule_id === "coder.bun.dead-code-reachability")).toEqual([]);

    await writeFile(smoke, `import { test } from "bun:test";
test("station support", () => {});
`);
    const mutant = await runImplementation("bun_ts_metrics_detector", { scanRoots: [root], excludes });
    expect(mutant.some(item => item.rule_id === "coder.bun.dead-code-reachability" && item.file.endsWith("e2e/support.ts"))).toBe(true);

    // Paired mutant: a production module imported only by a test is still dead code.
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "domain.ts"), "export const domain = () => 1;\n");
    await writeFile(smoke, `import { test } from "bun:test";
import { trainContext } from "../support.ts";
import { domain } from "../../src/domain.ts";
test("station support", () => { trainContext(); domain(); });
`);
    const production = await runImplementation("bun_ts_metrics_detector", { scanRoots: [root], excludes });
    const dead = production.filter(item => item.rule_id === "coder.bun.dead-code-reachability").map(item => item.file.slice(root.length + 1));
    expect(dead).toEqual(["src/domain.ts"]);
  });
}, 120_000);

// DOS validates its journey document in a reusable declaration() helper before route traversal.
test("JourneyRunner declaration helper is accepted while a non-parsing helper remains red", async () => {
  await withRoot("journey-declaration", async (root) => {
    await mkdir(join(root, "plan", "_journeys"), { recursive: true });
    await mkdir(join(root, "src", "trains"), { recursive: true });
    await writeFile(join(root, "plan", "_journeys", "journey.yaml"), "journey_id: journey:dos\n");
    await writeFile(join(root, "src", "server.ts"), "export const JOURNEY_MAP = {};\n");
    await writeFile(join(root, "src", "trains", "interlocking.ts"), "export class InterlockingRunner { async execute() { return { routeId: \"done\" }; } }\n");
    const journey = join(root, "src", "trains", "journey.ts");
    await writeFile(journey, `import { readFileSync } from "node:fs";
import { InterlockingRunner } from "./interlocking.ts";

function declaration(path: string): any {
  return Bun.YAML.parse(readFileSync(path, "utf8"));
}

export class JourneyRunner {
  constructor(private readonly journeyYamlPath: string) {}
  async execute(action: string, inputs: Record<string, unknown>) {
    const declared = declaration(this.journeyYamlPath);
    let current = declared.entrypoint.interlocking_id;
    for (;;) {
      const run = await new InterlockingRunner(current).execute(action, inputs);
      const continuation = declared.continuations.find((item: any) => item.from.interlocking_id === current);
      const terminal = declared.terminals.find((item: any) => item.from.interlocking_id === current);
      if (continuation) {
        current = continuation.to.interlocking_id;
        continue;
      }
      if (terminal) return { run, outcome: terminal.outcome };
      throw new Error("missing terminal");
    }
  }
}
`);

    const clean = await runImplementation("bun_interlocking_infrastructure", { scanRoots: [root], excludes });
    expect(clean.filter(item => item.rule_id === "coder.bun.journey-runner-boundary")).toEqual([]);

    await writeFile(journey, (await readFile(journey, "utf8")).replace(
      'return Bun.YAML.parse(readFileSync(path, "utf8"));',
      "return { entrypoint: {}, continuations: [], terminals: [] };",
    ));
    const mutant = await runImplementation("bun_interlocking_infrastructure", { scanRoots: [root], excludes });
    expect(mutant.some(item => item.evidence.includes("journey-runtime-transcription"))).toBe(true);

    // Paired mutants: the helper must read its own parameter, and routing must use the helper's result.
    const accepted = await readFile(journey, "utf8").then(text => text.replace(
      "return { entrypoint: {}, continuations: [], terminals: [] };",
      'return Bun.YAML.parse(readFileSync(path, "utf8"));',
    ));
    expect(accepted).toContain('readFileSync(path, "utf8")');
    await writeFile(journey, accepted);
    expect((await runImplementation("bun_interlocking_infrastructure", { scanRoots: [root], excludes }))
      .filter(item => item.rule_id === "coder.bun.journey-runner-boundary")).toEqual([]);

    await writeFile(journey, accepted.replace('readFileSync(path, "utf8")', 'readFileSync("plan/fixed.yaml", "utf8")'));
    const fixedPath = await runImplementation("bun_interlocking_infrastructure", { scanRoots: [root], excludes });
    expect(fixedPath.some(item => item.rule_id === "coder.bun.journey-runner-boundary")).toBe(true);

    const routed = "const declared = declaration(this.journeyYamlPath);";
    expect(accepted).toContain(routed);
    await writeFile(journey, accepted.replace(routed, "const declared = hardcoded();\n    void declaration(this.journeyYamlPath);") +
      'function hardcoded(): any { return { entrypoint: { interlocking_id: "a" }, continuations: [], terminals: [] }; }\n');
    const hardcoded = await runImplementation("bun_interlocking_infrastructure", { scanRoots: [root], excludes });
    expect(hardcoded.some(item => item.rule_id === "coder.bun.journey-runner-boundary")).toBe(true);
  });
}, 120_000);

// DOS keeps the actual InterlockingRunner result in a let assigned by a caught try before enriching it.
test("Station Master proof accepts a caught single JourneyRunner assignment and rejects a business-data mutant", async () => {
  const fixture = resolve(import.meta.dir, "../detectors/bun_interlocking_coverage/fixtures/clean/journey_station_master_production_shape");
  await withRoot("station-proof", async (root) => {
    await cp(fixture, root, { recursive: true });
    const journey = join(root, "src", "trains", "journey.ts");
    const original = "      const run = await new InterlockingRunner(path).execute(action, inputs, seed, context.handlers);";
    const caught = [
      "      let run: Awaited<ReturnType<InterlockingRunner[\"execute\"]>>;",
      "      try {",
      "        run = await new InterlockingRunner(path).execute(action, inputs, seed, context.handlers);",
      "      } catch (error) {",
      "        throw error;",
      "      }",
    ].join("\n");
    const source = await readFile(journey, "utf8");
    // The substitution must apply, otherwise this test would prove nothing about the caught shape.
    expect(source).toContain(original);
    await writeFile(journey, source.replace(original, caught));
    const config = { scanRoots: [root], excludes };
    expect(await runImplementation("bun_interlocking_coverage", config)).toEqual([]);
    expect(await runImplementation("bun_interlocking_infrastructure", config)).toEqual([]);

    // Paired mutant: a catch that swallows the error lets the post-try code see an unassigned run.
    const swallowed = caught.replace("        throw error;", "        // swallowed");
    expect(swallowed).not.toBe(caught);
    await writeFile(journey, source.replace(original, swallowed));
    const swallowedFindings = [
      ...await runImplementation("bun_interlocking_coverage", config),
      ...await runImplementation("bun_interlocking_infrastructure", config),
    ];
    expect(swallowedFindings.length).toBeGreaterThan(0);
    await writeFile(journey, source.replace(original, caught));

    // Paired mutant: the caught shape must still fail when the continuation is never followed.
    const accepted = await readFile(journey, "utf8");
    const followed = "        current = continuation.to.interlocking_id;\n";
    expect(accepted).toContain(followed);
    await writeFile(journey, accepted.replace(followed, "        return run.executed;\n"));
    const ignored = await runImplementation("bun_interlocking_infrastructure", config);
    expect(ignored.some(item => item.evidence.includes("journey-runtime-continuation-ignored"))).toBe(true);
    await writeFile(journey, accepted);

    const server = join(root, "src", "server.ts");
    await writeFile(server, (await readFile(server, "utf8")).replace(
      "return sourceRun ? { ...execution, source: sourceRun.result() } : execution;",
      'return { selectedTrainId: "train:source:refuse", source: sourceRun?.result() };',
    ));
    const findings = [
      ...await runImplementation("bun_interlocking_coverage", config),
      ...await runImplementation("bun_interlocking_infrastructure", config),
    ];
    expect(findings.some(item => item.rule_id === "coder.bun.station-master-interlocking-routing")).toBe(true);
  });
}, 120_000);
