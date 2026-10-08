import { expect, test } from "bun:test";
import { activationContextDigest, compareFindings, contextDigest, findingFingerprint, isStrictProfileExpansion, parseRatchetPolicy } from "../src/ratchet";

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

test("activation permits only a strict profile expansion and keeps every non-profile policy input bound", () => {
  const base = { profiles: ["flow"], topology: { plan_root: "plan" } };
  expect(isStrictProfileExpansion(["flow"], ["flow", "traceability"])).toBeTrue();
  expect(isStrictProfileExpansion(["flow", "traceability"], ["flow"])).toBeFalse();
  expect(isStrictProfileExpansion(["flow"], ["flow"])).toBeFalse();
  expect(activationContextDigest(base)).toBe(activationContextDigest({ ...base, profiles: ["flow", "traceability"], ratchet: { mode: "reject-new" } }));
  expect(activationContextDigest(base)).not.toBe(activationContextDigest({ ...base, profiles: ["flow", "traceability"], topology: { plan_root: "contracts" } }));
});

test("explicit consumer policy distinguishes report-only from reject-new and never stores a baseline", () => {
  expect(parseRatchetPolicy({ ratchet: { mode: "report", profiles: ["coder"] } })).toEqual({ mode: "report", profiles: ["coder"] });
  expect(parseRatchetPolicy({ ratchet: { mode: "reject-new", profiles: ["coder"] } })).toEqual({ mode: "reject-new", profiles: ["coder"] });
  expect(() => parseRatchetPolicy({ ratchet: { mode: "accept-baseline", profiles: ["coder"] } })).toThrow("ratchet.mode");
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
