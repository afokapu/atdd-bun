import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";
import { validatePlannerSchemas } from "../src/planner-schema-validator";
import { validateTelemetryPlan } from "../src/telemetry-plan";

// Regressions from the adversarial review of the telemetry profile. Each test is the
// reproduction that proved the finding, now asserting the fixed behaviour — the pattern
// tests/guard-review.test.ts set for PR #14.
const root = resolve(import.meta.dir, "..");
const repo = async (files: Record<string, string>) => {
  const dir = await mkdtemp(join(tmpdir(), "atdd-telemetry-review-"));
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(dir, path)), { recursive: true }); await writeFile(join(dir, path), content); }
  return dir;
};
const run = async (implementation: string, dir: string) => (await runImplementation(implementation, { scanRoots: [dir], excludes: [] })).map(v => `${v.rule_id} ${v.evidence}`);
const cleanUp = async (dir: string) => rm(dir, { recursive: true, force: true });

const E1_NA = "urn: wmbt:commons:E001\nacceptances:\n  - identity:\n      urn: acc:commons:E001-UNIT-001\n    telemetry:\n      disposition: not-applicable\n      rationale: No externally useful observable outcome beyond the tested return value.\n";
const E2_REQUIRED = "urn: wmbt:commons:E002\nacceptances:\n  - identity:\n      urn: acc:commons:E002-UNIT-001\n    telemetry:\n      disposition: required\n      events:\n        - telemetry:event:be:commons:response-invocation-accepted\n";
const ADOPTED = {
  "plan/commons/_commons.yaml": "urn: wagon:commons\nwagon: commons\nproduce:\n  - name: commons:response-invocation\n    contract: null\n    telemetry: telemetry:commons:response-invocation-accepted\n",
  "plan/commons/E001.yaml": E1_NA,
  "plan/commons/E002.yaml": E2_REQUIRED,
  "telemetry/commons/response-invocation-accepted/event.be.json": JSON.stringify({
    id: "telemetry:event:be:commons:response-invocation-accepted", version: "1.0.0",
    logical_artifact: "telemetry:commons:response-invocation-accepted", kind: "event", plane: "be", owner: "commons",
    purpose: "Records that a response invocation passed acceptance so ingress health can be audited.",
    acceptances: ["acc:commons:E001-UNIT-001", "acc:commons:E002-UNIT-001"],
    properties: { response_id: { type: "string", cardinality: "high" } }, required: ["response_id"],
  }, null, 2),
  "src/wagons/commons/features/ingress/domain/accept-response.ts": `// Telemetry: telemetry:event:be:commons:response-invocation-accepted\nexport function acceptResponse(response: { id: string }, telemetry: { emit(id: string, properties: Record<string, unknown>): void }): void {\n  telemetry.emit("telemetry:event:be:commons:response-invocation-accepted", { response_id: response.id });\n}\n`,
};
const BOUND_TEST = (acceptances: string) => `// URN: test:commons:ingress:E002-UNIT-001\n${acceptances.split("\n").filter(Boolean).map(a => `// Acceptance: ${a}`).join("\n")}\n// Telemetry: telemetry:event:be:commons:response-invocation-accepted\nimport { expect, mock, test } from "bun:test";\n\ntest("emits the planned event", () => {\n  const emit = mock(() => {});\n  expect(emit).toHaveBeenCalledWith("telemetry:event:be:commons:response-invocation-accepted", { response_id: "r-1" });\n});\n`;

test("#1 a spec file covering many acceptances is judged over the whole set, not the first header", async () => {
  // The requiring acceptance (E002) is listed SECOND; the first (E001) is not-applicable.
  const dir = await repo({ ...ADOPTED, "tests/wagons/commons/unit/spec.telemetry.test.ts": BOUND_TEST("acc:commons:E001-UNIT-001\nacc:commons:E002-UNIT-001") });
  try { expect(await run("bun_telemetry_test", dir)).toEqual([]); } finally { await cleanUp(dir); }
  // ...and the finding fires only when NONE of the bound acceptances requires the item.
  const only = await repo({ ...ADOPTED, "tests/wagons/commons/unit/spec.telemetry.test.ts": BOUND_TEST("acc:commons:E001-UNIT-001") });
  try {
    const findings = (await run("bun_telemetry_test", only)).filter(f => f.startsWith("tester.bun.telemetry-test-binding"));
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain("acc:commons:E001-UNIT-001 — none requires telemetry:event:be:commons:response-invocation-accepted");
  } finally { await cleanUp(only); }
});

test("#2 a comment does not satisfy a declared timing semantic; a test title does", async () => {
  const item = JSON.parse(ADOPTED["telemetry/commons/response-invocation-accepted/event.be.json"]);
  const withTiming = { ...item, timing: ["post-commit"] };
  const headers = "// URN: test:commons:ingress:E002-UNIT-001\n// Acceptance: acc:commons:E002-UNIT-001\n// Telemetry: telemetry:event:be:commons:response-invocation-accepted\n";
  const body = (title: string, comment: string) => `${headers}import { expect, mock, test } from "bun:test";\n${comment}test("${title}", () => {\n  const emit = mock(() => {});\n  expect(emit).toHaveBeenCalledWith("telemetry:event:be:commons:response-invocation-accepted", { response_id: "r-1" });\n});\n`;
  const commentOnly = await repo({
    ...ADOPTED,
    "telemetry/commons/response-invocation-accepted/event.be.json": JSON.stringify(withTiming, null, 2),
    "tests/wagons/commons/unit/spec.telemetry.test.ts": body("emits the planned event", "// the emission happens after the transaction commits, obviously\n"),
  });
  const titled = await repo({
    ...ADOPTED,
    "telemetry/commons/response-invocation-accepted/event.be.json": JSON.stringify(withTiming, null, 2),
    "tests/wagons/commons/unit/spec.telemetry.test.ts": body("emits the planned event once the invocation commits", ""),
  });
  try {
    const commentFindings = (await run("bun_telemetry_test", commentOnly)).filter(f => f.startsWith("tester.bun.telemetry-timing-semantics"));
    expect(commentFindings.length).toBe(1);
    expect(commentFindings[0]).toContain("declares timing semantic 'post-commit' but no bound telemetry test exercises it");
    expect((await run("bun_telemetry_test", titled)).filter(f => f.startsWith("tester.bun.telemetry-timing-semantics"))).toEqual([]);
  } finally { await cleanUp(commentOnly); await cleanUp(titled); }
});

test("#3 scoped vendor packages are caught, not only their bare names", async () => {
  const dir = await repo({
    ...ADOPTED,
    "src/wagons/commons/features/ingress/domain/tracking.ts": `import { Analytics } from "@segment/analytics-node";\nexport const analytics = Analytics;\n`,
  });
  try {
    const findings = (await run("bun_telemetry_code", dir)).filter(f => f.startsWith("coder.bun.telemetry-vendor-sdk"));
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain("'@segment/analytics-node'");
  } finally { await cleanUp(dir); }
});

test("#4 a commented-out emit call is not an emission", async () => {
  const dir = await repo({
    ...ADOPTED,
    "src/wagons/commons/features/ingress/domain/scratch.ts": `// telemetry.emit("order_accepted", {});\nexport const f = 1;\n`,
  });
  try { expect((await run("bun_telemetry_code", dir)).filter(f => f.includes("raw-string"))).toEqual([]); } finally { await cleanUp(dir); }
});

test("#5 the wmbt schema rejects contradictory embedded telemetry decisions", async () => {
  const wmbt = (telemetry: string) => `urn: wmbt:commons:E003\nstep: execute\ndirection: maximize\ndimension: likelihood\nobject_of_control: response\nlens: functional.efficiency\nacceptances:\n  - identity:\n      urn: acc:commons:E003-UNIT-001\n      id: AC-UNIT-001\n      purpose: prove the decision shape\n      phase: RED\n    harness:\n      type: unit\n      category: backend\n    given:\n      abstract: [a response invocation]\n    when:\n      abstract: the response is accepted\n    then:\n      abstract: [the acceptance is observable]\n${telemetry}\n`;
  const clean = await repo({ "plan/commons/E003.yaml": wmbt("    telemetry:\n      disposition: required\n      events:\n        - telemetry:event:be:commons:response-invocation-accepted") });
  const contradictory = await repo({ "plan/commons/E003.yaml": wmbt("    telemetry:\n      disposition: not-applicable\n      rationale: No externally useful observable outcome beyond the tested return value.\n      events:\n        - telemetry:event:be:commons:response-invocation-accepted") });
  const empty = await repo({ "plan/commons/E003.yaml": wmbt("    telemetry:\n      disposition: required") });
  try {
    expect(await validatePlannerSchemas(clean)).toEqual([]);
    for (const dir of [contradictory, empty]) {
      const findings = await validatePlannerSchemas(dir);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every(f => f.evidence.includes("/telemetry"))).toBeTrue();
    }
  } finally { await cleanUp(clean); await cleanUp(contradictory); await cleanUp(empty); }
});

test("#6 a family runner fails loudly when a member crashes without a report", async () => {
  // Reproduce the silent-pass failure mode directly: a family whose member crashes must exit
  // non-zero (runImplementation then throws with the stderr naming the member).
  const dir = await mkdtemp(join(tmpdir(), "atdd-telemetry-runner-"));
  await mkdir(join(dir, "checks"), { recursive: true });
  await copyFile(join(root, "detectors/bun_telemetry_code/detect.mjs"), join(dir, "detect.mjs"));
  await writeFile(join(dir, "checks/a_crashes.mjs"), "process.exit(3); // no report written\n");
  await writeFile(join(dir, "checks/b_healthy.mjs"), `import { emit } from "${join(root, "lib/scan.mjs")}";\nemit([]);\n`);
  try {
    const child = Bun.spawn({ cmd: [process.execPath, join(dir, "detect.mjs")], env: { ...process.env, ATDD_VIOLATIONS_REPORT: join(dir, "report.json") }, stdout: "pipe", stderr: "pipe" });
    const code = await child.exited;
    expect(code).toBe(2);
    expect(await new Response(child.stderr).text()).toContain("a_crashes.mjs crashed without a violation report");
    // The healthy members' report still documents what was collected before the loud exit decision.
  } finally { await cleanUp(dir); }
});

test("#7 a configured telemetry root is honoured by the plan-side validator", async () => {
  const dir = await repo({
    "atdd-bun.yaml": "topology:\n  telemetry_root: observability/plan\n",
    ...Object.fromEntries(Object.entries(ADOPTED).map(([path, content]) => [path.replace(/^telemetry\//, "observability/plan/"), content])),
  });
  try { expect(await validateTelemetryPlan(dir)).toEqual([]); } finally { await cleanUp(dir); }
});

test("#8 _generated trees under the telemetry root are never judged as items", async () => {
  const dir = await repo({ ...ADOPTED, "telemetry/_generated/bundle.json": "{\"not\":\"an item\"}" });
  try { expect(await validateTelemetryPlan(dir)).toEqual([]); } finally { await cleanUp(dir); }
});
