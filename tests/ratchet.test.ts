import { expect, test } from "bun:test";
import { activationContextDigest, canonicalFindingPath, compareFindings, contextDigest, findingFingerprint, isStrictProfileExpansion, parseRatchetPolicy } from "../src/ratchet";

const finding = (overrides: Record<string, unknown> = {}) => ({
  rule_id: "coder.bun.layer-naming",
  file: "src/wagons/orders/domain/order.ts",
  line: 4,
  col: 2,
  evidence: "presentation component is in domain",
  source_line: "export const OrderView = () => null;",
  subject: "component:orders:order",
  ...overrides,
});

test("finding fingerprints are semantic, deterministic, and do not depend on presentation coordinates", () => {
  const original = finding();
  const movedAndReworded = finding({ line: 99, col: 1, evidence: "different wording", source_line: "different source" });
  expect(findingFingerprint(original)).toBe(findingFingerprint(movedAndReworded));
  expect(findingFingerprint(finding({ subject: "component:orders:invoice" }))).not.toBe(findingFingerprint(original));
});

test("ratchet context binds exact effective profiles and normalized policy, excluding only the ratchet switch", () => {
  const base = { profiles: ["flow", "traceability"], topology: { plan_root: "plan" }, ratchet: { mode: "report" } };
  expect(contextDigest(base, ["flow", "traceability"])).toBe(contextDigest({ ...base, ratchet: { mode: "reject-new" } }, ["flow", "traceability"]));
  expect(contextDigest(base, ["flow", "traceability"])).not.toBe(contextDigest({ ...base, topology: { plan_root: "contracts" } }, ["flow", "traceability"]));
});

test("root-aware finding paths make equivalent base/candidate absolute and relative locations one carried identity", () => {
  const baseRoot = "/tmp/ratchet-base", candidateRoot = "/tmp/ratchet-candidate", path = "plan/_journeys/entitlement.yaml";
  const baseRelative = canonicalFindingPath(baseRoot, path), candidateAbsolute = canonicalFindingPath(candidateRoot, `${candidateRoot}/${path}`);
  expect(baseRelative).toBe(path); expect(candidateAbsolute).toBe(path);
  const baseFinding = finding({ file: baseRelative }), candidateFinding = finding({ file: candidateAbsolute });
  expect(findingFingerprint(baseFinding)).toBe(findingFingerprint(candidateFinding));
  expect(compareFindings([baseFinding], [candidateFinding])).toMatchObject({ carried: [findingFingerprint(baseFinding)], new: [], resolved: [] });
  expect(() => canonicalFindingPath(baseRoot, "../outside.yaml")).toThrow("repository-relative");
  expect(() => canonicalFindingPath(baseRoot, "/tmp/elsewhere.yaml")).toThrow("repository-relative");
});

test("activation permits only a strict profile expansion and keeps every non-profile policy input bound", () => {
  const base = { profiles: ["flow"], topology: { plan_root: "plan" } };
  expect(isStrictProfileExpansion(["flow"], ["flow", "traceability"])).toBeTrue();
  expect(isStrictProfileExpansion(["flow", "traceability"], ["flow"])).toBeFalse();
  expect(isStrictProfileExpansion(["flow"], ["flow"])).toBeFalse();
  expect(activationContextDigest(base)).toBe(activationContextDigest({ ...base, profiles: ["flow", "traceability"], ratchet: { mode: "reject-new" } }));
  expect(activationContextDigest(base)).not.toBe(activationContextDigest({ ...base, profiles: ["flow", "traceability"], topology: { plan_root: "contracts" } }));
});

test("finding-inert worktrees policy is excluded from both context digests while every other key still participates", () => {
  const base = { profiles: ["flow", "traceability"], topology: { plan_root: "plan" }, max_staged_files: 20, protected_branches: ["main"], ratchet: { mode: "reject-new", profiles: ["flow", "traceability"] } };
  const profiles = ["flow", "traceability"];
  // Pinned v1 digests for a config without `worktrees`: existing frozen contexts must stay byte-identical.
  expect(contextDigest(base, profiles)).toBe("158dfae64ea298051a8e903268a90a06a0d206c344be0b26bd9d4672c0bf8bd8");
  expect(activationContextDigest(base)).toBe("5690c1aefa82050f69eb3b395e52cb448eb182d9ebfca0df2789b6b8c32d1b3a");
  for (const worktrees of [{ enabled: true }, { enabled: true, require_linked_worktree: true, root: "../.worktrees" }, { enabled: false }]) {
    expect(contextDigest({ ...base, worktrees }, profiles)).toBe(contextDigest(base, profiles));
    expect(activationContextDigest({ ...base, worktrees })).toBe(activationContextDigest(base));
  }
  for (const changed of [{ topology: { plan_root: "contracts" } }, { max_staged_files: 5 }, { protected_branches: ["develop"] }, { require_traceability: false }]) {
    expect(contextDigest({ ...base, ...changed, worktrees: { enabled: true } }, profiles)).not.toBe(contextDigest(base, profiles));
    expect(activationContextDigest({ ...base, ...changed, worktrees: { enabled: true } })).not.toBe(activationContextDigest(base));
  }
});

test("explicit consumer policy distinguishes report-only from reject-new and never stores a baseline", () => {
  expect(parseRatchetPolicy({ ratchet: { mode: "report", profiles: ["coder"] } })).toEqual({ mode: "report", profiles: ["coder"] });
  expect(parseRatchetPolicy({ ratchet: { mode: "reject-new", profiles: ["coder"] } })).toEqual({ mode: "reject-new", profiles: ["coder"] });
  expect(() => parseRatchetPolicy({ ratchet: { mode: "accept-baseline", profiles: ["coder"] } })).toThrow("ratchet.mode");
  expect(() => parseRatchetPolicy({ ratchet: { mode: "reject-new", profiles: ["coder"], baseline: "mutable" } })).toThrow("baselines and waivers");
  expect(() => parseRatchetPolicy({ ratchet: { mode: "reject-new", profiles: ["coder"], waiver: "skip" } })).toThrow("baselines and waivers");
});

test("exact-base comparison classifies carried/new/resolved findings", () => {
  const carried = finding();
  const resolved = finding({ rule_id: "tester.bun.test-phase-declared", subject: "test:orders:unit" });
  const introduced = finding({ rule_id: "security.bun.no-secret", subject: "src:orders:token" });
  expect(compareFindings([carried, resolved], [carried, introduced])).toEqual({
    carried: [findingFingerprint(carried)],
    new: [findingFingerprint(introduced)],
    resolved: [findingFingerprint(resolved)],
  });
});
