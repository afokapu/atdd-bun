import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { enforce } from "../src/enforce";
import { validateTelemetryPlan } from "../src/telemetry-plan";

// The telemetry tracking plan: the plan-side half of the telemetry profile. Each test is a minimal
// repository, because the questions here are about activation and resolution semantics, not prose.
const root = resolve(import.meta.dir, "..");

async function repo(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "atdd-telemetry-"));
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(dir, path)), { recursive: true }); await writeFile(join(dir, path), content); }
  return dir;
}

const WAGON = `urn: wagon:commons
wagon: commons
produce:
  - name: commons:response-invocation
    contract: null
    telemetry: telemetry:commons:response-invocation-accepted
`;
const DECIDED = `urn: wmbt:commons:E001
acceptances:
  - identity:
      urn: acc:commons:E001-UNIT-001
    telemetry:
      disposition: required
      events:
        - telemetry:event:be:commons:response-invocation-accepted
`;
const UNDECIDED = `urn: wmbt:commons:E002
acceptances:
  - identity:
      urn: acc:commons:E002-UNIT-001
`;
const ITEM = JSON.stringify({
  id: "telemetry:event:be:commons:response-invocation-accepted",
  version: "1.0.0",
  logical_artifact: "telemetry:commons:response-invocation-accepted",
  kind: "event", plane: "be", owner: "commons",
  purpose: "Records that a response invocation passed acceptance so ingress health can be audited.",
  acceptances: ["acc:commons:E001-UNIT-001"],
  properties: { response_id: { type: "string", classification: "internal", cardinality: "high" } },
  required: ["response_id"],
}, null, 2);

const clean = async () => repo({
  "plan/commons/_commons.yaml": WAGON,
  "plan/commons/E001.yaml": DECIDED,
  "plan/commons/E002.yaml": `urn: wmbt:commons:E002\nacceptances:\n  - identity:\n      urn: acc:commons:E002-UNIT-001\n    telemetry:\n      disposition: not-applicable\n      rationale: No externally useful observable outcome beyond the tested return value.\n`,
  "telemetry/commons/response-invocation-accepted/event.be.json": ITEM,
});

test("the capability is inert until adopted: no telemetry root and no declaration means no findings", async () => {
  const dir = await repo({ "plan/commons/E001.yaml": UNDECIDED });
  try { expect(await validateTelemetryPlan(dir)).toEqual([]); } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the first declaration activates the closure for every acceptance in the plan", async () => {
  const dir = await repo({ "plan/commons/E001.yaml": DECIDED, "plan/commons/E002.yaml": UNDECIDED });
  try {
    const findings = await validateTelemetryPlan(dir);
    // E001's required item has no registry entry; E002 has no decision at all — partial adoption does not pass.
    expect(findings.map(f => f.rule_id)).toEqual(["planner.telemetry.acceptance-decision", "planner.telemetry.acceptance-decision"]);
    expect(findings.some(f => f.evidence.includes("has no tracking-plan entry"))).toBeTrue();
    expect(findings.some(f => f.evidence.includes("declares no telemetry decision"))).toBeTrue();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a fully adopted plan and registry is clean, through the detector contract", async () => {
  const dir = await clean();
  try {
    expect(await enforce({ root: dir, profiles: ["telemetry"] })).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an id that does not mirror its path is a schema finding, and the duplicate id is too", async () => {
  const dir = await repo({
    "plan/commons/_commons.yaml": WAGON, "plan/commons/E001.yaml": DECIDED,
    "telemetry/commons/response-invocation-accepted/event.be.json": ITEM,
    "telemetry/commons/renamed/event.be.json": ITEM,
  });
  try {
    const findings = await validateTelemetryPlan(dir);
    expect(findings.some(f => f.rule_id === "planner.telemetry.tracking-plan-schema" && f.evidence.includes("does not mirror its path"))).toBeTrue();
    expect(findings.some(f => f.rule_id === "planner.telemetry.tracking-plan-schema" && f.evidence.includes("is declared by both"))).toBeTrue();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an item whose logical artifact no wagon produces is unowned", async () => {
  const dir = await repo({
    "plan/commons/_commons.yaml": WAGON, "plan/commons/E001.yaml": DECIDED,
    "telemetry/commons/response-invocation-accepted/event.be.json": ITEM,
    "telemetry/commons/orphan-artifact/event.be.json": JSON.stringify({
      id: "telemetry:event:be:commons:orphan-artifact", version: "1.0.0",
      logical_artifact: "telemetry:commons:orphan-artifact", kind: "event", plane: "be", owner: "commons",
      purpose: "Records an outcome no wagon has declared ownership of.",
      acceptances: [], properties: { outcome: { type: "string" } }, required: ["outcome"],
    }, null, 2),
  });
  try {
    const findings = await validateTelemetryPlan(dir);
    expect(findings.filter(f => f.rule_id === "planner.telemetry.logical-ownership").map(f => f.evidence)).toEqual([
      "logical artifact telemetry:commons:orphan-artifact is produced by no wagon; declare it in exactly one wagon's produce[] telemetry",
    ]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an owner field that disagrees with the owning wagon is a finding", async () => {
  const dir = await repo({
    "plan/commons/_commons.yaml": WAGON, "plan/commons/E001.yaml": DECIDED,
    "telemetry/commons/response-invocation-accepted/event.be.json": JSON.stringify({ ...JSON.parse(ITEM), owner: "response-ingress" }),
  });
  try {
    const findings = await validateTelemetryPlan(dir);
    expect(findings.some(f => f.rule_id === "planner.telemetry.logical-ownership" && f.evidence.includes("does not match the owning wagon 'commons'"))).toBeTrue();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("high-cardinality metric dimensions are rejected, by declaration and by property reference", async () => {
  const metric = JSON.stringify({
    id: "telemetry:metric:be:commons:response-invocation-accepted:duration", version: "1.0.0",
    logical_artifact: "telemetry:commons:response-invocation-accepted", kind: "metric", plane: "be",
    measure: "duration", instrument: "histogram", owner: "commons",
    purpose: "Bounds how long an accepted response invocation takes to complete end to end.",
    acceptances: ["acc:commons:E001-UNIT-001"],
    properties: { response_id: { type: "string", cardinality: "high" } },
    dimensions: [{ name: "response_id", cardinality: "high" }, { name: "request_id", cardinality: "low" }],
  }, null, 2);
  const dir = await repo({
    "plan/commons/_commons.yaml": WAGON,
    "plan/commons/E001.yaml": `urn: wmbt:commons:E001\nacceptances:\n  - identity:\n      urn: acc:commons:E001-UNIT-001\n    telemetry:\n      disposition: required\n      events:\n        - telemetry:event:be:commons:response-invocation-accepted\n      metrics:\n        - telemetry:metric:be:commons:response-invocation-accepted:duration\n`,
    "telemetry/commons/response-invocation-accepted/event.be.json": ITEM,
    "telemetry/commons/response-invocation-accepted/metric.be.duration.json": metric,
  });
  try {
    const findings = await validateTelemetryPlan(dir);
    expect(findings.filter(f => f.rule_id === "planner.telemetry.metric-cardinality").map(f => f.evidence)).toEqual([
      "telemetry:metric:be:commons:response-invocation-accepted:duration dimension 'response_id' is high-cardinality; carry the identifier in an event, log or trace property instead",
    ]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("not-applicable without a rationale, and unknown dispositions, are decisions this rule rejects", async () => {
  const dir = await repo({
    "plan/commons/_commons.yaml": WAGON,
    "plan/commons/E001.yaml": `urn: wmbt:commons:E001\nacceptances:\n  - identity:\n      urn: acc:commons:E001-UNIT-001\n    telemetry:\n      disposition: not-applicable\n      rationale: too short\n`,
    "plan/commons/E002.yaml": `urn: wmbt:commons:E002\nacceptances:\n  - identity:\n      urn: acc:commons:E002-UNIT-001\n    telemetry:\n      disposition: maybe\n`,
    "telemetry/commons/response-invocation-accepted/event.be.json": ITEM,
  });
  try {
    const findings = await validateTelemetryPlan(dir);
    expect(findings.every(f => f.rule_id === "planner.telemetry.acceptance-decision")).toBeTrue();
    expect(findings.some(f => f.evidence.includes("without a rationale"))).toBeTrue();
    expect(findings.some(f => f.evidence.includes("must be required or not-applicable"))).toBeTrue();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an item referencing an acceptance nothing declares dangles", async () => {
  const dir = await repo({
    "plan/commons/_commons.yaml": WAGON, "plan/commons/E001.yaml": DECIDED,
    "telemetry/commons/response-invocation-accepted/event.be.json": JSON.stringify({ ...JSON.parse(ITEM), acceptances: ["acc:commons:E099-UNIT-001"] }),
  });
  try {
    const findings = await validateTelemetryPlan(dir);
    expect(findings.some(f => f.rule_id === "planner.telemetry.acceptance-decision" && f.evidence.includes("references undeclared acceptance acc:commons:E099-UNIT-001"))).toBeTrue();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the telemetry profile runs only the telemetry detector, and the package's own tree stays inert", async () => {
  // The package repository itself has no telemetry root and no acceptance declarations: upgrading
  // must not fail it, exactly as it must not fail any unadopting consumer.
  const findings = await enforce({ root, profiles: ["telemetry"] });
  expect(findings).toEqual([]);
});
