// URN: test:toolkit:owner-inspection-evidence:E001-UNIT-001-bound-test-file
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { OwnerInspectionRecord } from "@afokapu/atdd-flow/src/owner-inspection";
import { OWNER_INSPECTION_RULE_IDS, checkOwnerInspection } from "../src/index";
import type { OwnerInspectionCandidate } from "../src/index";

// Read-only consumer proof for the Flow-owned owner-inspection/v1 record. The record shape is Flow's; nothing here
// copies, publishes, stores, or acknowledges it. Rule ids are Bun's applicability policy.
const ruleId = (name: string) => `atdd-bun.review.owner-inspectability.${name}`;
const SHA = "a".repeat(40);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const files: Record<string, string> = {
  "evidence/health.txt": "health ok",
  "evidence/smoke.txt": "smoke ok",
  "evidence/teardown.txt": "teardown ok",
  "evidence/rendered.txt": "rendered ok",
  "evidence/ratchet.json": "{\"new\":0}",
};
const tracked = (extra: Record<string, string> = {}): OwnerInspectionCandidate => ({
  sha: SHA,
  readTracked: async (path) => (path in { ...files, ...extra } ? new TextEncoder().encode({ ...files, ...extra }[path]) : undefined),
});
const ref = (path: string, kind = "file") => ({ kind, locator: path, sha256: digest(files[path]) });
const record = (patch: Partial<OwnerInspectionRecord> = {}): OwnerInspectionRecord => ({
  schema: "atdd-workflow/owner-inspection/v1",
  id: "inspect-1",
  stage: "candidate",
  parent: { project: "atdd-bun", task: "owner-inspectability-convention-main-20261028" },
  owner: "driver.owner-inspection-convention@atdd-bun",
  surface: { kind: "service", name: "orders" },
  scenario: "place an order",
  data_classification: "synthetic",
  target: { kind: "local", locator: "http://127.0.0.1:4310/" },
  provenance: { task: "owner-inspectability-convention-main-20261028", commit: SHA },
  evidence: { health: ref("evidence/health.txt"), smoke: ref("evidence/smoke.txt"), teardown: ref("evidence/teardown.txt"), rendered: ref("evidence/rendered.txt") },
  published_by: "driver.owner-inspection-convention@atdd-bun",
  published_at: "2026-11-14T17:50:00.000Z",
  ...patch,
});
const ids = (result: { findings: { rule_id: string | null }[] }) => new Set(result.findings.map((finding) => finding.rule_id));
const only = (name: string) => new Set([ruleId(name)]);
const check = (value: OwnerInspectionRecord, candidate = tracked(), mode?: "candidate" | "done") => checkOwnerInspection({ record: value, candidate, mode });

test("a valid synthetic local record bound to the candidate passes with every evidence digest verified", async () => {
  const result = await check(record());
  expect(result.verdict).toBe("PASS");
  expect(result.findings).toEqual([]);
});

test("the rule ids are the declared Bun applicability policy", () => {
  expect(new Set(OWNER_INSPECTION_RULE_IDS)).toEqual(new Set(["stale-candidate", "evidence-digest-mismatch", "non-local-target", "non-synthetic-data", "missing-teardown", "invalid-not-applicable", "unacknowledged"].map(ruleId)));
});

test("a record published for a different commit is a stale candidate", async () => {
  const result = await check(record({ provenance: { task: "t", commit: "b".repeat(40) } }));
  expect(result.verdict).toBe("FAIL");
  expect(ids(result)).toEqual(only("stale-candidate"));
});

test("a merge record without its candidate citation is a stale candidate", async () => {
  const result = await check(record({ stage: "merge" }));
  expect(ids(result)).toEqual(only("stale-candidate"));
});

test("evidence whose tracked bytes differ from the recorded digest is a digest mismatch", async () => {
  const result = await check(record(), tracked({ "evidence/smoke.txt": "smoke changed after the claim" }));
  expect(result.verdict).toBe("FAIL");
  expect(ids(result)).toEqual(only("evidence-digest-mismatch"));
});

test("a local target must be loopback; a remote or credentialed local URL is refused", async () => {
  for (const locator of ["http://example.com/", "http://10.0.0.5:4310/", "http://user:pw@127.0.0.1:4310/", "http://127.0.0.1.evil.test/"]) {
    expect(ids(await check(record({ target: { kind: "local", locator } }))), locator).toEqual(only("non-local-target"));
  }
  expect((await check(record({ target: { kind: "local", locator: "http://localhost:4310/" } }))).verdict).toBe("PASS");
});

test("a sandbox or preview target is reported with the owner-directive rationale", async () => {
  for (const kind of ["sandbox", "preview"]) {
    const result = await check(record({ target: { kind, locator: "https://preview.example.test/" } }));
    expect(ids(result), kind).toEqual(only("non-local-target"));
    expect(result.findings[0].message).toContain("M-20261011T121147Z");
  }
});

test("any data classification other than synthetic is non-synthetic data", async () => {
  for (const data_classification of ["production", "customer", "Synthetic ", ""]) {
    expect(ids(await check(record({ data_classification }))), data_classification).toEqual(only("non-synthetic-data"));
  }
});

test("a missing or blank teardown reference is a missing teardown", async () => {
  const missing = record();
  delete (missing.evidence as Partial<typeof missing.evidence>).teardown;
  expect(ids(await check(missing))).toEqual(only("missing-teardown"));
  const blank = record({ evidence: { ...record().evidence, teardown: { kind: "file", locator: "evidence/teardown.txt", sha256: "" } } });
  expect(ids(await check(blank))).toEqual(only("missing-teardown"));
});

test("rendered N/A is valid only for a toolkit surface with a rationale and ci, ratchet, or package evidence", async () => {
  const na = (rationale: string, kind: string) => ({ na: true as const, rationale, evidence: ref("evidence/ratchet.json", kind) });
  const toolkit = (rendered: OwnerInspectionRecord["evidence"]["rendered"]) => record({ surface: { kind: "toolkit", name: "atdd-bun" }, evidence: { ...record().evidence, rendered } });
  expect((await check(toolkit(na("toolkit repository has no served surface", "ratchet")))).verdict).toBe("PASS");
  expect(ids(await check(toolkit(na("", "ratchet"))))).toEqual(only("invalid-not-applicable"));
  expect(ids(await check(toolkit(na("no surface", "screenshot"))))).toEqual(only("invalid-not-applicable"));
  expect(ids(await check(record({ evidence: { ...record().evidence, rendered: na("no surface", "ratchet") } })))).toEqual(only("invalid-not-applicable"));
});

test("done mode requires an operator acknowledgement; candidate mode does not", async () => {
  expect((await check(record(), tracked(), "candidate")).verdict).toBe("PASS");
  expect(ids(await check(record(), tracked(), "done"))).toEqual(only("unacknowledged"));
  const acknowledged = record({ acknowledgements: [{ schema: "atdd-workflow/owner-inspection-ack/v1", immutable: true, inspection: "inspect-1", sequence: 1, by: "operator@desk", note: "seen", at: "2026-11-14T18:00:00.000Z" }] });
  expect((await check(acknowledged, tracked(), "done")).verdict).toBe("PASS");
});

test("evidence that is not a tracked path can never pass and is reported as could-not-check", async () => {
  const ci = record({ evidence: { ...record().evidence, rendered: { kind: "ci", locator: "https://github.com/afokapu/atdd-bun/actions/runs/1", sha256: digest("ci") } } });
  const result = await check(ci);
  expect(result.verdict).toBe("COULD_NOT_CHECK");
  expect(result.findings).toEqual([]);
});

test("the check is read-only: it reads only tracked paths and never writes, spawns, or touches the network", async () => {
  const reads: string[] = [];
  const trap = (name: string) => () => { throw new Error(`forbidden ${name}`); };
  const original = { fetch: globalThis.fetch, spawn: Bun.spawn, write: Bun.write };
  globalThis.fetch = trap("fetch") as unknown as typeof fetch;
  Bun.spawn = trap("spawn") as unknown as typeof Bun.spawn;
  Bun.write = trap("write") as unknown as typeof Bun.write;
  try {
    const candidate = { sha: SHA, readTracked: async (path: string) => { reads.push(path); return tracked().readTracked(path); } };
    expect((await check(record(), candidate)).verdict).toBe("PASS");
  } finally {
    Object.assign(globalThis, { fetch: original.fetch });
    Bun.spawn = original.spawn;
    Bun.write = original.write;
  }
  expect(new Set(reads)).toEqual(new Set(["evidence/health.txt", "evidence/smoke.txt", "evidence/teardown.txt", "evidence/rendered.txt"]));
});

test("the convention is registered in the existing flow profile and names the policy-only decorative boundary", async () => {
  const root = join(import.meta.dir, "..");
  const profile = await readFile(join(root, "conventions/_profiles/flow.yaml"), "utf8");
  expect(profile).toContain("atdd-bun.review.owner-inspectability");
  const convention = await readFile(join(root, "conventions/atdd-bun.review/atdd-bun.review.owner-inspectability.convention.yaml"), "utf8");
  expect(convention).toContain("rule_id: atdd-bun.review.owner-inspectability");
  expect(convention).toContain("synthetic");
  expect(convention).toContain("decorative");
  expect(convention).toContain("not machine-checkable");
});
