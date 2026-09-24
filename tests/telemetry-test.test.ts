import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { enforce } from "../src/enforce";
import { runImplementation } from "../src/enforce";

// The test-side half of the telemetry profile: bindings, captured sinks, exact identity,
// required-item coverage, and declared timing semantics. Minimal repositories again.
const root = resolve(import.meta.dir, "..");
const repo = async (files: Record<string, string>) => {
  const dir = await mkdtemp(join(tmpdir(), "atdd-telemetry-test-"));
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(dir, path)), { recursive: true }); await writeFile(join(dir, path), content); }
  return dir;
};
const run = async (dir: string) => (await runImplementation("bun_telemetry_test", { scanRoots: [dir], excludes: [] })).map(v => `${v.rule_id} ${v.evidence}`);
const cleanUp = async (dir: string) => rm(dir, { recursive: true, force: true });

const ADOPTED = {
  "plan/commons/_commons.yaml": "urn: wagon:commons\nwagon: commons\nproduce:\n  - name: commons:response-invocation\n    contract: null\n    telemetry: telemetry:commons:response-invocation-accepted\n",
  "plan/commons/E001.yaml": "urn: wmbt:commons:E001\nacceptances:\n  - identity:\n      urn: acc:commons:E001-UNIT-001\n    telemetry:\n      disposition: required\n      events:\n        - telemetry:event:be:commons:response-invocation-accepted\n",
  "telemetry/commons/response-invocation-accepted/event.be.json": JSON.stringify({
    id: "telemetry:event:be:commons:response-invocation-accepted", version: "1.0.0",
    logical_artifact: "telemetry:commons:response-invocation-accepted", kind: "event", plane: "be", owner: "commons",
    purpose: "Records that a response invocation passed acceptance so ingress health can be audited.",
    acceptances: ["acc:commons:E001-UNIT-001"],
    properties: { response_id: { type: "string", cardinality: "high" } },
    required: ["response_id"],
  }, null, 2),
};
const GOOD_TEST = `// URN: test:commons:ingress:E001-UNIT-001\n// Acceptance: acc:commons:E001-UNIT-001\n// Telemetry: telemetry:event:be:commons:response-invocation-accepted\nimport { expect, mock, test } from "bun:test";\n\ntest("emits the planned event", () => {\n  const emit = mock(() => {});\n  expect(emit).toHaveBeenCalledWith("telemetry:event:be:commons:response-invocation-accepted", { response_id: "r-1" });\n});\n`;

test("inert until adopted: telemetry-shaped tests without a registry emit nothing", async () => {
  const dir = await repo({ "tests/wagons/commons/unit/x.telemetry.test.ts": GOOD_TEST });
  try { expect(await run(dir)).toEqual([]); } finally { await cleanUp(dir); }
});

test("a bound, exact, captured-sink test on a required item is clean", async () => {
  const dir = await repo({ ...ADOPTED, "tests/wagons/commons/unit/x.telemetry.test.ts": GOOD_TEST });
  try { expect(await run(dir)).toEqual([]); } finally { await cleanUp(dir); }
});

test("a Telemetry: reference without an Acceptance: binding, or to an unknown item, is a finding", async () => {
  const dir = await repo({
    ...ADOPTED,
    "tests/wagons/commons/unit/unbound.telemetry.test.ts": `// URN: test:commons:ingress:E001-UNIT-001\n// Telemetry: telemetry:event:be:commons:response-invocation-accepted\nimport { expect, mock, test } from "bun:test";\ntest("t", () => { const emit = mock(() => {}); expect(emit).toHaveBeenCalledWith("telemetry:event:be:commons:response-invocation-accepted", {}); });\n`,
    "tests/wagons/commons/unit/dangling.telemetry.test.ts": `// URN: test:commons:ingress:E001-UNIT-001\n// Acceptance: acc:commons:E001-UNIT-001\n// Telemetry: telemetry:event:be:commons:unknown-item\nimport { expect, mock, test } from "bun:test";\ntest("t", () => { const emit = mock(() => {}); expect(emit).not.toHaveBeenCalled(); });\n`,
  });
  try {
    const findings = (await run(dir)).filter(f => f.startsWith("tester.bun.telemetry-test-binding"));
    expect(findings.some(f => f.includes("binds telemetry but no Acceptance"))).toBeTrue();
    expect(findings.some(f => f.includes("does not resolve to a tracking-plan item"))).toBeTrue();
  } finally { await cleanUp(dir); }
});

test("a test bound to an acceptance whose decision does not list the item is a finding", async () => {
  const dir = await repo({
    ...ADOPTED,
    "plan/commons/E002.yaml": "urn: wmbt:commons:E002\nacceptances:\n  - identity:\n      urn: acc:commons:E002-UNIT-001\n    telemetry:\n      disposition: not-applicable\n      rationale: No externally useful observable outcome beyond the tested return value.\n",
    "tests/wagons/commons/unit/wrong-acc.telemetry.test.ts": `// URN: test:commons:ingress:E002-UNIT-001\n// Acceptance: acc:commons:E002-UNIT-001\n// Telemetry: telemetry:event:be:commons:response-invocation-accepted\nimport { expect, mock, test } from "bun:test";\ntest("t", () => { const emit = mock(() => {}); expect(emit).toHaveBeenCalledWith("telemetry:event:be:commons:response-invocation-accepted", {}); });\n`,
  });
  try {
    const findings = await run(dir);
    expect(findings.some(f => f.startsWith("tester.bun.telemetry-test-binding") && f.includes("does not require"))).toBeTrue();
  } finally { await cleanUp(dir); }
});

test("return-value-only assertions and header-only identities are findings", async () => {
  const dir = await repo({
    ...ADOPTED,
    "tests/wagons/commons/unit/loose.telemetry.test.ts": `// URN: test:commons:ingress:E001-UNIT-001\n// Acceptance: acc:commons:E001-UNIT-001\n// Telemetry: telemetry:event:be:commons:response-invocation-accepted\nimport { expect, test } from "bun:test";\ntest("accepts", () => { const done: string[] = []; expect(done.length).toBe(0); });\n`,
  });
  try {
    const findings = await run(dir);
    expect(findings.some(f => f.startsWith("tester.bun.telemetry-captured-sink") && f.includes("asserts no emission"))).toBeTrue();
    expect(findings.some(f => f.startsWith("tester.bun.telemetry-identity-assertion") && f.includes("never asserts the exact identity"))).toBeTrue();
  } finally { await cleanUp(dir); }
});

test("a required item no test binds is uncovered", async () => {
  const dir = await repo({
    ...ADOPTED,
    "plan/commons/E001.yaml": "urn: wmbt:commons:E001\nacceptances:\n  - identity:\n      urn: acc:commons:E001-UNIT-001\n    telemetry:\n      disposition: required\n      events:\n        - telemetry:event:be:commons:response-invocation-accepted\n      metrics:\n        - telemetry:metric:be:commons:response-invocation-accepted:duration\n",
    "telemetry/commons/response-invocation-accepted/metric.be.duration.json": JSON.stringify({
      id: "telemetry:metric:be:commons:response-invocation-accepted:duration", version: "1.0.0",
      logical_artifact: "telemetry:commons:response-invocation-accepted", kind: "metric", plane: "be", measure: "duration",
      owner: "commons", purpose: "Bounds how long an accepted response invocation takes to complete end to end.",
      acceptances: ["acc:commons:E001-UNIT-001"], properties: { outcome: { type: "string", cardinality: "low" } },
      required: ["outcome"], dimensions: [{ name: "outcome", cardinality: "low" }],
    }, null, 2),
    "tests/wagons/commons/unit/x.telemetry.test.ts": GOOD_TEST, // binds the event only
  });
  try {
    const findings = (await run(dir)).filter(f => f.startsWith("tester.bun.telemetry-required-item-coverage"));
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain("telemetry:metric:be:commons:response-invocation-accepted:duration is required by an acceptance but no telemetry test binds it");
  } finally { await cleanUp(dir); }
});

test("a declared timing semantic must be exercised by a bound test", async () => {
  const item = JSON.parse(ADOPTED["telemetry/commons/response-invocation-accepted/event.be.json"]);
  const withTiming = { ...item, timing: ["post-commit"] };
  const quiet = await repo({
    ...ADOPTED,
    "telemetry/commons/response-invocation-accepted/event.be.json": JSON.stringify(withTiming, null, 2),
    "tests/wagons/commons/unit/x.telemetry.test.ts": GOOD_TEST, // no mention of commit
  });
  const loud = await repo({
    ...ADOPTED,
    "telemetry/commons/response-invocation-accepted/event.be.json": JSON.stringify(withTiming, null, 2),
    "tests/wagons/commons/unit/x.telemetry.test.ts": GOOD_TEST.replace('test("emits the planned event"', 'test("emits the planned event once the invocation commits"'),
  });
  try {
    const quietFindings = (await run(quiet)).filter(f => f.startsWith("tester.bun.telemetry-timing-semantics"));
    expect(quietFindings.length).toBe(1);
    expect(quietFindings[0]).toContain("declares timing semantic 'post-commit' but no bound telemetry test exercises it");
    expect((await run(loud)).filter(f => f.startsWith("tester.bun.telemetry-timing-semantics"))).toEqual([]);
  } finally { await cleanUp(quiet); await cleanUp(loud); }
});

test("the telemetry profile now spans plan, code and test detectors; the package tree stays inert", async () => {
  expect((await enforce({ root, profiles: ["telemetry"] }))).toEqual([]);
});
