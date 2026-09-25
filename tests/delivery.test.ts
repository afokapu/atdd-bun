import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deliveryAdopted, deliveryPolicy, loosenedDelivery, validateDelivery } from "../src/delivery";
import { loosenedPolicy } from "../src/integrity";

// The delivery profile judges the record a tranche leaves of its reviews. Each test is a minimal repository,
// because the questions are about adoption, policy and the merge gate, not prose.

async function repo(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "atdd-delivery-"));
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(dir, path)), { recursive: true }); await writeFile(join(dir, path), content); }
  return dir;
}
async function withRepo(files: Record<string, string>, body: (dir: string) => Promise<void>) {
  const dir = await repo(files);
  try { await body(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const rules = async (dir: string, gate = false) => (await validateDelivery(dir, { gate, base: "main" })).map(f => f.rule_id);
const evidence = async (dir: string) => (await validateDelivery(dir, { gate: false })).map(f => f.evidence);

const ADOPT = "profiles: [delivery]\n";
type Review = Record<string, unknown>;
const review = (stage: string, sha: string, author: [string, string], reviewer: [string, string], extra: Review = {}): Review =>
  ({ stage, sha, author: { model: author[0], run: author[1] }, reviewer: { model: reviewer[0], run: reviewer[1] }, verdict: "approve", checked: ["ACC-001"], ...extra });
const FULL = [
  review("plan_review", "1111111", ["codex", "driver"], ["glm", "r1"]),
  review("test_review", "2222222", ["glm", "a1"], ["codex", "r2"]),
  review("code_review", "3333333", ["glm", "a2"], ["glm", "r3"]),
  review("final_review", "3333333", ["codex", "driver"], ["codex", "r4"]),
];
const record = (reviews: Review[], extra: Record<string, unknown> = {}) => JSON.stringify({ tranche: "api", status: "open", base_sha: "0abcdef", reviews, ...extra });
const FINDING = { id: "F1", severity: "high", evidence: "handler.ts:42 returns a bare string", invariant: "coded error bodies", proposed_fix: "return a coded body" };

test("the capability is inert until adopted in atdd-bun.yaml", async () => {
  expect(deliveryAdopted({})).toBeFalse();
  expect(deliveryAdopted({ profiles: ["traceability"], delivery: {} })).toBeFalse();
  expect(deliveryAdopted({ delivery: {} })).toBeTrue();
  expect(deliveryAdopted({ profiles: ["delivery"] })).toBeTrue();
  await withRepo({ "delivery/api/evidence.yaml": "not: [valid" }, async dir => expect(await rules(dir)).toEqual([]));
  await withRepo({ "atdd-bun.yaml": "profiles: [traceability]\n", "delivery/api/evidence.yaml": "{}" }, async dir => expect(await rules(dir)).toEqual([]));
});

test("a complete, independent record in progress is clean", async () => {
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(FULL) }, async dir => expect(await rules(dir)).toEqual([]));
});

test("a malformed policy is reported and the evidence is judged against the defaults", async () => {
  await withRepo({ "atdd-bun.yaml": "delivery:\n  stages:\n    code_review: { reviewers: [] }\n", "delivery/api/evidence.yaml": record(FULL) }, async dir => {
    expect(await rules(dir)).toEqual(["delivery.config-schema"]);
  });
});

test("stages the policy omits are not required, and a review of one is out of policy", async () => {
  const policy = "delivery:\n  stages:\n    code_review: { reviewers: [claude] }\n";
  await withRepo({ "atdd-bun.yaml": policy, "delivery/api/evidence.yaml": record([review("code_review", "3333333", ["glm", "a"], ["claude", "r"])], { status: "ready", approved_sha: "3333333" }) }, async dir => {
    expect((await rules(dir)).filter(id => id !== "delivery.approved-sha-resolves")).toEqual([]);
  });
  await withRepo({ "atdd-bun.yaml": policy, "delivery/api/evidence.yaml": record(FULL) }, async dir => {
    expect((await evidence(dir)).filter(e => e.includes("not a configured stage")).length).toBe(3);
  });
});

test("a fallback model needs a recorded reason for every model it skipped, in list order", async () => {
  const skipped = [...FULL.slice(0, 2), review("code_review", "3333333", ["glm", "a2"], ["claude", "r3"]), FULL[3]];
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(skipped) }, async dir => {
    expect(await evidence(dir)).toEqual([expect.stringContaining("no fallback from 'glm'")]);
  });
  const recorded = [...FULL.slice(0, 2), review("code_review", "3333333", ["glm", "a2"], ["claude", "r3"], { fallback: [{ from: "glm", reason: "rate limit: 3 failures in 10 minutes" }] }), FULL[3]];
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(recorded) }, async dir => expect(await rules(dir)).toEqual([]));
  // An author fallback is recorded under its own role: a reviewer fallback does not excuse it.
  const author = [...FULL.slice(0, 2), review("code_review", "3333333", ["claude", "a2"], ["glm", "r3"], { fallback: [{ from: "glm", reason: "provider outage since 09:00" }] }), FULL[3]];
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(author) }, async dir => {
    expect(await evidence(dir)).toEqual([expect.stringContaining("author 'claude' is a fallback"), expect.stringContaining("reviewer fallback from 'glm' does not precede 'glm'")]);
  });
});

test("independence: a fresh process per review, never an author, and a different model where the stage asks", async () => {
  const reused = [...FULL.slice(0, 3), review("final_review", "3333333", ["codex", "driver"], ["codex", "r1"])];
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(reused) }, async dir => expect(await rules(dir)).toEqual(["delivery.reviewer-independent"]));
  const selfReview = [...FULL.slice(0, 3), review("final_review", "3333333", ["codex", "driver"], ["codex", "driver"])];
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(selfReview) }, async dir => expect(await evidence(dir)).toEqual([expect.stringContaining("also authored")]));
  // GLM reviewing GLM passes under fresh-process and fails once code_review asks for a different model.
  const strict = "delivery:\n  stages:\n    plan_review: { reviewers: [glm, claude] }\n    test_review: { reviewers: [codex, claude] }\n    code_review: { reviewers: [glm, claude], independence: different-model }\n    final_review: { reviewers: [codex, claude] }\n";
  await withRepo({ "atdd-bun.yaml": strict, "delivery/api/evidence.yaml": record(FULL) }, async dir => expect(await evidence(dir)).toEqual([expect.stringContaining("code_review requires a different model")]));
});

test("findings: fixed or withdrawn needs a fresh re-review, withdrawn needs a rebuttal, human needs the decision", async () => {
  const round = (finding: Record<string, unknown>, later = true) => [FULL[0], FULL[1], review("code_review", "3333333", ["glm", "a2"], ["glm", "r3"], { verdict: "request_changes", findings: [{ ...FINDING, ...finding }] }), ...(later ? [review("code_review", "4444444", ["glm", "a3"], ["glm", "r5"])] : [])];
  const judged = async (reviews: Review[], status = "open") => { let out: string[] = []; await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(reviews, { status }) }, async dir => { out = (await validateDelivery(dir, { gate: false })).filter(f => f.rule_id === "delivery.findings-resolved").map(f => f.evidence); }); return out; };
  expect(await judged(round({}, false))).toEqual([]);                           // work in progress
  expect(await judged(round({}))).toEqual([expect.stringContaining("has no outcome")]);
  expect(await judged(round({ outcome: "fixed" }))).toEqual([]);
  expect(await judged(round({ outcome: "fixed" }, false))).toEqual([expect.stringContaining("no later code_review confirms it")]);
  expect(await judged(round({ outcome: "withdrawn" }))).toEqual([expect.stringContaining("without a rebuttal")]);
  expect(await judged(round({ outcome: "withdrawn", rebuttal: "handler.test.ts:31 proves the loop stops on abort" }))).toEqual([]);
  expect(await judged(round({ outcome: "human" }, false))).toEqual([expect.stringContaining("records no decision")]);
  expect(await judged(round({ outcome: "human", decision: "Keep the retry; the caller owns the bound." }, false))).toEqual([]);
});

test("a finding upheld after its dispute goes to a human, never to a second round", async () => {
  const rebuttal = "handler.test.ts:31 proves the loop stops on abort";
  const disputed = (second: Record<string, unknown>) => [FULL[0], FULL[1],
    review("code_review", "3333333", ["glm", "a2"], ["glm", "r3"], { verdict: "request_changes", findings: [{ ...FINDING, rebuttal, outcome: "withdrawn" }] }),
    review("code_review", "4444444", ["glm", "a3"], ["glm", "r5"], { verdict: "request_changes", findings: [{ ...FINDING, rebuttal, ...second }] }),
    review("code_review", "5555555", ["glm", "a4"], ["glm", "r6"])];
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(disputed({ outcome: "withdrawn" })) }, async dir => {
    expect(await evidence(dir)).toEqual([expect.stringContaining("raises it again"), expect.stringContaining("disputed 2 times")]);
  });
  const ruled = disputed({ outcome: "human", decision: "The bound belongs to the caller; keep it." });
  ruled[2] = review("code_review", "3333333", ["glm", "a2"], ["glm", "r3"], { verdict: "request_changes", findings: [{ ...FINDING, rebuttal, outcome: "human", decision: "Upheld by the second reviewer; ruled below." }] });
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(ruled) }, async dir => expect(await rules(dir)).toEqual([]));
});

test("ready means every configured stage approved and approved_sha is what the closing review approved", async () => {
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(FULL.slice(0, 3), { status: "ready", approved_sha: "3333333" }) }, async dir => {
    expect(await evidence(dir)).toContain("status is ready, but final_review has no review");
  });
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(FULL, { status: "ready", approved_sha: "9999999" }) }, async dir => {
    expect(await evidence(dir)).toContain("approved_sha 9999999 is not the SHA the last final_review approved (3333333)");
  });
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(FULL, { status: "ready" }) }, async dir => {
    expect((await evidence(dir)).some(e => e.includes("must have required property 'approved_sha'"))).toBeTrue();
  });
});

test("loosening the policy is reported; tightening is silent", () => {
  const strict = { delivery: { independence: "different-model" } }, base = { delivery: {} };
  expect(loosenedDelivery(base, strict)).toEqual([]);
  expect(loosenedDelivery(strict, base)).toEqual(STAGE_NAMES.map(stage => `delivery.stages.${stage}.independence different-model → fresh-process`));
  expect(loosenedDelivery(base, { delivery: { stages: { code_review: { reviewers: ["glm"] } } } })).toEqual(["delivery.stages drops plan_review", "delivery.stages drops test_review", "delivery.stages drops final_review"]);
  expect(loosenedDelivery(base, { delivery: { stages: { ...deliveryPolicy({}).stages, code_review: { reviewers: ["glm", "claude", "gpt"] } } } })).toEqual(["delivery.stages.code_review.reviewers adds gpt"]);
  expect(loosenedDelivery(base, {})).toEqual(["delivery is no longer adopted (the delivery: block was removed)"]);
  // Through the integrity check: dropping the profile from an explicit list is reported once, as a dropped profile.
  expect(loosenedPolicy({ profiles: ["delivery"] }, { profiles: ["traceability"] }).filter(line => line.includes("delivery"))).toEqual(["profiles drops delivery"]);
});
const STAGE_NAMES = ["plan_review", "test_review", "code_review", "final_review"];

// The merge gate needs history: a real repository with a base branch and a tranche branch.
async function sh(cwd: string, ...cmd: string[]) {
  const child = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (await child.exited) throw new Error(`${cmd.join(" ")}: ${await new Response(child.stderr).text()}`);
  return (await new Response(child.stdout).text()).trim();
}
async function tranche(body: (dir: string, commit: (message: string, files: Record<string, string>) => Promise<string>) => Promise<void>) {
  await withRepo({ "atdd-bun.yaml": ADOPT, "src/app.ts": "export const a = 1;\n" }, async dir => {
    await sh(dir, "git", "init", "-q", "-b", "main"); await sh(dir, "git", "add", "-A"); await sh(dir, "git", "commit", "-qm", "base");
    await sh(dir, "git", "checkout", "-qb", "tranche/api");
    const commit = async (message: string, files: Record<string, string>) => {
      for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(dir, path)), { recursive: true }); await writeFile(join(dir, path), content); }
      await sh(dir, "git", "add", "-A"); await sh(dir, "git", "commit", "-qm", message);
      return sh(dir, "git", "rev-parse", "HEAD");
    };
    await body(dir, commit);
  });
}
const approved = (sha: string, status = "ready") => record(FULL.map(r => r.stage === "final_review" ? { ...r, sha } : r), { status, approved_sha: sha });
const gate = async (dir: string) => (await validateDelivery(dir, { gate: true, base: "main" })).filter(f => f.rule_id === "delivery.merge-gate").map(f => f.evidence);

test("the merge gate accepts a head that differs from its approved SHA only by the evidence", async () => {
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", { "delivery/api/evidence.yaml": approved(sha) });
    expect(await rules(dir, true)).toEqual([]);
    // Outside the gate the same repository is judged without the change set.
    expect(await rules(dir, false)).toEqual([]);
  });
});

test("the merge gate rejects a change after approval and a record that is not ready", async () => {
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", { "delivery/api/evidence.yaml": approved(sha) });
    await commit("fix: after approval", { "src/app.ts": "export const a = 3;\n" });
    expect(await gate(dir)).toEqual([expect.stringContaining("changes src/app.ts after approved_sha")]);
  });
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", { "delivery/api/evidence.yaml": approved(sha, "open") });
    expect(await gate(dir)).toEqual(["delivery/api/evidence.yaml is open; a tranche merges only when its record is ready"]);
  });
});

test("the merge gate judges only records the branch changes, and reads a merge checkout as base and head", async () => {
  await tranche(async (dir, commit) => {
    // An earlier tranche, merged long ago: its approved SHA is no longer the head of anything.
    const old = await commit("feat: old", { "src/old.ts": "export const o = 1;\n" });
    await commit("chore: old evidence", { "delivery/old/evidence.yaml": approved(old).replace('"api"', '"old"') });
    await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "merge", "-q", "--ff-only", "tranche/api");
    await sh(dir, "git", "checkout", "-qb", "tranche/next");
    const sha = await commit("feat: next", { "src/app.ts": "export const a = 5;\n" });
    await commit("chore: evidence", { "delivery/next/evidence.yaml": approved(sha).replace('"api"', '"next"') });
    expect(await gate(dir)).toEqual([]);
    // CI checks out the PR as a merge commit: first parent is the base, second the tranche head.
    await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "commit", "-q", "--allow-empty", "-m", "main moves on");
    await sh(dir, "git", "merge", "-q", "--no-ff", "-m", "merge", "tranche/next");
    expect((await validateDelivery(dir, { gate: true, base: "does-not-exist" })).filter(f => f.rule_id === "delivery.merge-gate")).toEqual([]);
  });
});

test("the merge gate fails loudly when it cannot find the base", async () => {
  await tranche(async dir => {
    expect((await validateDelivery(dir, { gate: true, base: "origin/nowhere" })).map(f => f.evidence)).toEqual([expect.stringContaining("cannot resolve the base branch")]);
  });
});
