import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runImplementation } from "../src/enforce";

// The code-side half of the telemetry profile: source references, raw strings, the vendor-SDK
// boundary, and forbidden properties. Minimal repositories, because the questions are about
// activation, resolution and exemption semantics.
const repo = async (files: Record<string, string>) => {
  const dir = await mkdtemp(join(tmpdir(), "atdd-telemetry-code-"));
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(dir, path)), { recursive: true }); await writeFile(join(dir, path), content); }
  return dir;
};
const run = async (dir: string) => (await runImplementation("bun_telemetry_code", { scanRoots: [dir], excludes: [] })).map(v => `${v.rule_id} ${v.evidence}`);
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
    forbidden_properties: ["raw_payload", "secret", "prompt"],
  }, null, 2),
};

test("inert until adopted: raw strings and vendor imports without a registry emit nothing", async () => {
  const dir = await repo({
    "src/wagons/commons/features/ingress/domain/accept.ts": `// Telemetry: telemetry:event:be:commons:response-invocation-accepted\nimport { trace } from "@opentelemetry/api";\nexport const f = (emit: (id: string) => void) => emit("order_accepted");\n`,
  });
  try { expect(await run(dir)).toEqual([]); } finally { await cleanUp(dir); }
});

test("a clean adoption passes: bound reference, declared id, port-only core, adapter holds the SDK", async () => {
  const dir = await repo({
    ...ADOPTED,
    "src/wagons/commons/features/ingress/domain/accept-response.ts": `// Telemetry: telemetry:event:be:commons:response-invocation-accepted\nexport function acceptResponse(response: { id: string }, telemetry: { emit(id: string, properties: Record<string, unknown>): void }): void {\n  telemetry.emit("telemetry:event:be:commons:response-invocation-accepted", { response_id: response.id });\n}\n`,
    "src/wagons/commons/features/ingress/infrastructure/otel-adapter.ts": `import { metrics } from "@opentelemetry/api";\nexport const otel = { emit(id: string, properties: Record<string, unknown>) { metrics.getMeter("commons").createCounter(id).add(1, properties as Record<string, string>); } };\n`,
    "tests/wagons/commons/unit/accept.test.ts": `import { test } from "bun:test";\ntest("probe", () => { const sink = { emit: (id: string) => id }; sink.emit("fixture_only_probe_event"); });\n`,
  });
  try { expect(await run(dir)).toEqual([]); } finally { await cleanUp(dir); }
});

test("unresolved and malformed Telemetry: references are findings", async () => {
  const dir = await repo({
    ...ADOPTED,
    "src/wagons/commons/features/ingress/domain/accept.ts": `// Telemetry: telemetry:event:be:commons:unknown-item\n// Telemetry: order-created\nexport const f = 1;\n`,
  });
  try {
    const findings = await run(dir);
    expect(findings.filter(f => f.startsWith("coder.bun.telemetry-source-binding")).length).toBe(2);
    expect(findings.some(f => f.includes("does not resolve to a tracking-plan item"))).toBeTrue();
    expect(findings.some(f => f.includes("is not a concrete telemetry URN"))).toBeTrue();
  } finally { await cleanUp(dir); }
});

test("an undeclared event-shaped string is rejected; declared ids and non-event strings pass", async () => {
  const dir = await repo({
    ...ADOPTED,
    "src/wagons/commons/features/ingress/domain/accept.ts": `export const f = (emit: (id: string, props?: Record<string, unknown>) => void) => {\n  emit("order_accepted");\n  emit("Order Created");\n  emit("responseInvocationAccepted");\n  emit("telemetry:event:be:commons:response-invocation-accepted");\n  emit("info");\n};\n`,
  });
  try {
    const findings = (await run(dir)).filter(f => f.startsWith("coder.bun.telemetry-raw-string-emit"));
    expect(findings.map(f => f.match(/'(.*?)'/)![1])).toEqual(["order_accepted", "Order Created", "responseInvocationAccepted"]);
  } finally { await cleanUp(dir); }
});

test("a vendor SDK import is rejected in domain and allowed in infrastructure", async () => {
  const dir = await repo({
    ...ADOPTED,
    "src/wagons/commons/features/ingress/domain/tracing.ts": `import { trace } from "@opentelemetry/api";\nexport const tracer = trace.getTracer("commons");\n`,
    "src/wagons/commons/features/ingress/infrastructure/otel.ts": `import { trace } from "@opentelemetry/api";\nexport const t = trace.getTracer("commons");\n`,
    "src/wagons/commons/features/ingress/integration/otel.ts": `import { trace } from "@opentelemetry/api";\nexport const t = trace.getTracer("commons");\n`,
  });
  try {
    const findings = (await run(dir)).filter(f => f.startsWith("coder.bun.telemetry-vendor-sdk"));
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain("domain layer imports telemetry vendor SDK '@opentelemetry/api'");
  } finally { await cleanUp(dir); }
});

test("forbidden properties are caught through snake_case and camelCase spellings", async () => {
  const dir = await repo({
    ...ADOPTED,
    "src/wagons/commons/features/ingress/domain/accept.ts": `export const f = (emit: (id: string, properties: Record<string, unknown>) => void) => {\n  emit("telemetry:event:be:commons:response-invocation-accepted", { response_id: "r-1", raw_payload: "x", secret: "k", nested: { prompt: "p" } });\n};\n`,
  });
  try {
    const findings = (await run(dir)).filter(f => f.startsWith("coder.bun.telemetry-forbidden-properties"));
    expect(findings.map(f => f.match(/property '(.*?)'/)![1]).sort()).toEqual(["raw_payload", "secret"]);
  } finally { await cleanUp(dir); }
});

test("a reference inside a string literal is not a Telemetry: reference", async () => {
  const dir = await repo({
    ...ADOPTED,
    "src/wagons/commons/features/ingress/domain/accept.ts": "// Telemetry: telemetry:event:be:commons:response-invocation-accepted\nexport const f = 1;\n",
    "src/wagons/commons/features/ingress/domain/note.ts": `export const note = "// Telemetry: telemetry:event:be:commons:unknown-item";\n`,
  });
  try { expect(await run(dir)).toEqual([]); } finally { await cleanUp(dir); }
});

test("a required item no source binds is an implementation-binding finding", async () => {
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
    "src/wagons/commons/features/ingress/domain/accept.ts": `// Telemetry: telemetry:event:be:commons:response-invocation-accepted\nexport const f = 1;\n`,
  });
  try {
    const findings = (await run(dir)).filter(f => f.startsWith("coder.bun.telemetry-implementation-binding"));
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain("telemetry:metric:be:commons:response-invocation-accepted:duration is required by an acceptance but no implementation source binds it");
  } finally { await cleanUp(dir); }
});
