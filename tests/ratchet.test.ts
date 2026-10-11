import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { concreteProfiles, defaultProfiles, enabledProfiles } from "../src/enforce";
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

// Canonical all-profile reject-new activation. The governed base is the clean canonical main lineage commit; it has no
// atdd-bun.yaml, so it runs the 14 implicit defaults (no optional flow) under no ratchet. The frozen candidate context
// is exactly the 15 supported profiles, in registry order, with an identical reject-new ratchet.
const BASE = "a13a6fec85186dfa81211d8005aad9461ba6f568";
const PROFILES = ["traceability", "topology", "docs", "planner", "telemetry", "coder", "tester", "security", "architecture", "metrics", "runtime", "interlocking", "htmx", "design", "flow"];
const PROFILE_LIST_DIGEST = "933b2570af48eecce1c01294d7a61b1c71f80949205cc1b8ec3af13516e4bd53";
const repositoryRoot = resolve(import.meta.dir, "..");

async function git(...args: string[]) {
  const child = Bun.spawn({ cmd: ["git", ...args], cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  return { code: await child.exited, out: (await new Response(child.stdout).text()).trim() };
}

test("the supported registry order and newline-delimited digest are the frozen all-15 profile list", () => {
  expect(concreteProfiles).toEqual(PROFILES as never);
  expect(createHash("sha256").update(PROFILES.map(profile => `${profile}\n`).join("")).digest("hex")).toBe(PROFILE_LIST_DIGEST);
});

test("the exact governed base is an ancestor with implicit 14 defaults, no flow, and no ratchet configuration", async () => {
  expect((await git("cat-file", "-t", BASE)).out).toBe("commit");
  expect((await git("merge-base", "--is-ancestor", BASE, "HEAD")).code).toBe(0);
  expect((await git("cat-file", "-e", `${BASE}:atdd-bun.yaml`)).code).not.toBe(0);
  expect(defaultProfiles).toHaveLength(14);
  expect(defaultProfiles).not.toContain("flow" as never);
});

test("the candidate declares the explicit ordered all-15 profiles and an identical reject-new ratchet as its only context", async () => {
  const file = resolve(repositoryRoot, "atdd-bun.yaml");
  expect(existsSync(file)).toBeTrue();
  const config = Bun.YAML.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  expect(config.profiles).toEqual(PROFILES);
  expect(config.ratchet).toEqual({ mode: "reject-new", profiles: PROFILES });
  expect(parseRatchetPolicy(config)?.mode).toBe("reject-new");
  expect(await enabledProfiles(repositoryRoot)).toEqual(PROFILES as never);
  // `worktrees` is finding-inert and excluded from the context digest, so it is the only key allowed beside the context.
  expect(Object.keys(config).sort()).toEqual(["profiles", "ratchet", "worktrees"]);
  expect(contextDigest(config, PROFILES)).toBe(contextDigest({ profiles: PROFILES }, PROFILES));
});
