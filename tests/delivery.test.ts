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

// Most tests exercise the rules, not the default location, so they pin the short root `delivery`; the default
// (docs/delivery/tranches) has its own tests below.
const ADOPT = "profiles: [delivery]\ndelivery:\n  root: delivery\n";
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
const WINDOW = { from: "2026-09-25T09:00:00Z", to: "2026-09-25T09:08:00Z" };
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

test("the multiplexer is named in the policy, herdr by default, any command name accepted", async () => {
  expect(deliveryPolicy({}).multiplexer).toBe("herdr");
  expect(deliveryPolicy({ multiplexer: "tmux" }).multiplexer).toBe("tmux");
  await withRepo({ "atdd-bun.yaml": "delivery:\n  root: delivery\n  multiplexer: zellij\n", "delivery/api/evidence.yaml": record(FULL) }, async dir => expect(await rules(dir)).toEqual([]));
  await withRepo({ "atdd-bun.yaml": "delivery:\n  root: delivery\n  multiplexer: Herdr CLI\n", "delivery/api/evidence.yaml": record(FULL) }, async dir => expect(await rules(dir)).toEqual(["delivery.config-schema"]));
});

test("a malformed policy is reported and the evidence is judged against the defaults", async () => {
  await withRepo({ "atdd-bun.yaml": "delivery:\n  root: delivery\n  stages:\n    code_review: { reviewers: [] }\n", "delivery/api/evidence.yaml": record(FULL) }, async dir => {
    expect(await rules(dir)).toEqual(["delivery.config-schema"]);
  });
});

test("stages the policy omits are not required, and a review of one is out of policy", async () => {
  const policy = "delivery:\n  root: delivery\n  stages:\n    code_review: { reviewers: [claude] }\n";
  await withRepo({ "atdd-bun.yaml": policy, "delivery/api/code.json": "{}", "delivery/api/evidence.yaml": record([review("code_review", "3333333", ["glm", "a"], ["claude", "r"], { report: "delivery/api/code.json" })], { status: "ready", approved_sha: "3333333" }) }, async dir => {
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
  const recorded = [...FULL.slice(0, 2), review("code_review", "3333333", ["glm", "a2"], ["claude", "r3"], { fallback: [{ from: "glm", kind: "rate_limit", failures: 3, window: WINDOW, reason: "rate limit: 3 failures in 10 minutes" }] }), FULL[3]];
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(recorded) }, async dir => expect(await rules(dir)).toEqual([]));
  // An author fallback is recorded under its own role: a reviewer fallback does not excuse it.
  const author = [...FULL.slice(0, 2), review("code_review", "3333333", ["claude", "a2"], ["glm", "r3"], { fallback: [{ from: "glm", kind: "outage", failures: 3, window: WINDOW, reason: "provider outage since 09:00" }] }), FULL[3]];
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
  const strict = "delivery:\n  root: delivery\n  stages:\n    plan_review: { reviewers: [glm, claude] }\n    test_review: { reviewers: [codex, claude] }\n    code_review: { reviewers: [glm, claude], independence: different-model }\n    final_review: { reviewers: [codex, claude] }\n";
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
  expect(loosenedDelivery(base, {})).toEqual(["delivery is no longer adopted"]);
  // A first explicit list is an adoption, but not of less than the delivery block already adopted.
  expect(loosenedDelivery(base, { profiles: ["docs"], delivery: {} })).toEqual(["delivery is no longer adopted"]);
  expect(loosenedDelivery({ profiles: ["delivery"] }, { profiles: ["docs"] })).toEqual([]);   // reported as `profiles drops delivery`
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
// A ready record retains every review's raw output next to it.
const tranchePR = (tranche: string, sha: string, status = "ready") => ({
  // Every stage approves a real commit in the approved history (here the approved one itself).
  [`delivery/${tranche}/evidence.yaml`]: record(FULL.map(r => ({ ...r, sha, report: `delivery/${tranche}/${r.stage}.json` })), { tranche, status, approved_sha: sha }),
  ...Object.fromEntries(FULL.map(r => [`delivery/${tranche}/${r.stage}.json`, "{}\n"])),
});
const gate = async (dir: string) => (await validateDelivery(dir, { gate: true, base: "main" })).filter(f => f.rule_id === "delivery.merge-gate").map(f => f.evidence);

test("the merge gate accepts a head that differs from its approved SHA only by the evidence", async () => {
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", tranchePR("api", sha));
    expect(await rules(dir, true)).toEqual([]);
    // Outside the gate the same repository is judged without the change set.
    expect(await rules(dir, false)).toEqual([]);
  });
});

test("the merge gate rejects a change after approval and a record that is not ready", async () => {
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", tranchePR("api", sha));
    await commit("fix: after approval", { "src/app.ts": "export const a = 3;\n" });
    expect(await gate(dir)).toEqual([expect.stringContaining("changes src/app.ts after approved_sha")]);
  });
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", tranchePR("api", sha, "open"));
    expect(await gate(dir)).toEqual(["delivery/api/evidence.yaml is open; a tranche merges only when its record is ready"]);
  });
});

test("the merge gate judges only records the branch changes, and reads a merge checkout as base and head", async () => {
  await tranche(async (dir, commit) => {
    // An earlier tranche, merged long ago: its approved SHA is no longer the head of anything.
    const old = await commit("feat: old", { "src/old.ts": "export const o = 1;\n" });
    await commit("chore: old evidence", tranchePR("old", old));
    await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "merge", "-q", "--ff-only", "tranche/api");
    await sh(dir, "git", "checkout", "-qb", "tranche/next");
    const sha = await commit("feat: next", { "src/app.ts": "export const a = 5;\n" });
    await commit("chore: evidence", tranchePR("next", sha));
    expect(await gate(dir)).toEqual([]);
    // CI checks out the PR as a merge commit: first parent is the base, second the tranche head.
    await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "commit", "-q", "--allow-empty", "-m", "main moves on");
    await sh(dir, "git", "merge", "-q", "--no-ff", "-m", "merge", "tranche/next");
    // With no explicit base, the merge checkout's parents are the range (an unresolvable explicit base fails closed).
    const saved = process.env.ATDD_BASE_REF; delete process.env.ATDD_BASE_REF;
    try { expect((await validateDelivery(dir, { gate: true })).filter(f => f.rule_id === "delivery.merge-gate")).toEqual([]); } finally { if (saved !== undefined) process.env.ATDD_BASE_REF = saved; }
    expect((await validateDelivery(dir, { gate: true, base: "does-not-exist" })).map(f => f.evidence)).toEqual([expect.stringContaining("cannot resolve the base branch")]);
  });
});

test("the merge gate fails loudly when it cannot find the base", async () => {
  await tranche(async dir => {
    expect((await validateDelivery(dir, { gate: true, base: "origin/nowhere" })).map(f => f.evidence)).toEqual([expect.stringContaining("cannot resolve the base branch")]);
  });
});

// Regressions from the first headless review of PR #19 (Codex, fbfe235). One test per finding.

test("F1: a change outside the delivery root with no tranche record fails the gate, unless require_record is off", async () => {
  await tranche(async (dir, commit) => {
    await commit("feat: sneaks past", { "src/app.ts": "export const a = 9;\n" });
    expect(await gate(dir)).toEqual([expect.stringContaining("changes src/app.ts with no tranche record under delivery/")]);
    await commit("chore: opt out", { "atdd-bun.yaml": "profiles: [delivery]\ndelivery:\n  root: delivery\n  require_record: false\n" });
    expect(await gate(dir)).toEqual([]);
  });
  expect(loosenedDelivery({ delivery: {} }, { delivery: { require_record: false } })).toEqual(["delivery.require_record true → false"]);
});

test("F2: an approving review cannot carry a critical or high finding", async () => {
  const approving = [...FULL.slice(0, 3), review("final_review", "3333333", ["codex", "driver"], ["codex", "r4"], { findings: [{ ...FINDING, severity: "critical" }, { ...FINDING, id: "F2", severity: "low" }] })];
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(approving) }, async dir => {
    expect(await evidence(dir)).toEqual(["reviews[3] (final_review) approves with critical finding F1; a critical or high finding requests changes"]);
  });
});

test("F3: moving the root, adding an author, or making fallback easier is a loosening", () => {
  const base = { delivery: {} };
  expect(loosenedDelivery(base, { delivery: { root: "unused" } })).toEqual(["delivery.root docs/delivery/tranches → unused"]);
  expect(loosenedDelivery(base, { delivery: { stages: { ...deliveryPolicy({}).stages, plan_review: { authors: ["codex", "gpt"], reviewers: ["glm", "claude"] } } } })).toEqual(["delivery.stages.plan_review.authors adds gpt"]);
  expect(loosenedDelivery(base, { delivery: { fallback: { after_failures: 1, within_minutes: 60 } } })).toEqual(["delivery.fallback.after_failures 3 → 1", "delivery.fallback.within_minutes 10 → 60"]);
  expect(loosenedDelivery(base, { delivery: { fallback: { after_failures: 5, within_minutes: 5 } } })).toEqual([]);
});

test("F4: a fallback states a kind of unavailability and at least the policy's failure count", async () => {
  const fallback = (entry: Record<string, unknown>) => [...FULL.slice(0, 2), review("code_review", "3333333", ["glm", "a2"], ["claude", "r3"], { fallback: [{ from: "glm", reason: "the reviewer requested changes", window: WINDOW, ...entry }] }), FULL[3]];
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(fallback({ kind: "request_changes", failures: 3 })) }, async dir => {
    expect(await rules(dir)).toEqual(["delivery.evidence-schema"]);
  });
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(fallback({ kind: "rate_limit", failures: 1 })) }, async dir => {
    expect(await evidence(dir)).toEqual([expect.stringContaining("after 1 failure(s); the policy requires 3")]);
  });
});

test("F5: after the merge, the pushed commit must contain the approved one; a squash merge fails visibly", async () => {
  const pushed = async (dir: string) => (await validateDelivery(dir, { gate: "post-merge" })).filter(f => f.rule_id === "delivery.merge-gate").map(f => f.evidence);
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", tranchePR("api", sha));
    await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "merge", "-q", "--no-ff", "-m", "merge", "tranche/api");
    expect(await pushed(dir)).toEqual([]);
  });
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", tranchePR("api", sha));
    await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "merge", "-q", "--squash", "tranche/api"); await sh(dir, "git", "commit", "-qm", "squash");
    expect(await pushed(dir)).toEqual([expect.stringContaining("a squash or rebase merge rewrites the approved commit")]);
  });
});

test("F6: a ready record retains every review's raw report", async () => {
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/final.json": "{}", "delivery/api/evidence.yaml": record(FULL.map((r, i) => i === 3 ? { ...r, report: "delivery/api/final.json" } : i === 2 ? { ...r, report: "delivery/api/gone.json" } : r), { status: "ready", approved_sha: "3333333" }) }, async dir => {
    expect((await evidence(dir)).filter(e => e.includes("report"))).toEqual([
      "status is ready, but reviews[0] (plan_review) retains no report",
      "status is ready, but reviews[1] (test_review) retains no report",
      "status is ready, but reviews[2] (code_review) names report delivery/api/gone.json, which is not a regular file",
    ]);
  });
});

test("F7: the root has one spelling; a non-canonical one is a config finding and is read canonically", async () => {
  expect(deliveryPolicy({ root: "delivery/" }).root).toBe("delivery");
  expect(deliveryPolicy({ root: "./ops//delivery/" }).root).toBe("ops/delivery");
  await withRepo({ "atdd-bun.yaml": "delivery:\n  root: delivery/\n", "delivery/api/evidence.yaml": record(FULL) }, async dir => {
    expect(await rules(dir)).toEqual(["delivery.config-schema"]);
  });
});

// Regressions from the second headless review of PR #19 (GLM, fbfe235). Findings that repeat Codex's are covered above.

test("GLM F2: deleting a tranche record fails the gate; records are append-only", async () => {
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", tranchePR("api", sha, "open"));
    await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "merge", "-q", "--no-ff", "-m", "merge", "tranche/api");
    await sh(dir, "git", "checkout", "-qb", "tranche/erase");
    await sh(dir, "git", "rm", "-rq", "delivery/api"); await commit("chore: erase", { "src/app.ts": "export const a = 3;\n" });
    expect(await gate(dir)).toContain("the branch deletes delivery/api/evidence.yaml; records are append-only, and deleting one would escape its findings and the gate");
  });
});

test("GLM F3: at the gate, a ready record already on the base branch is not re-judged", async () => {
  await tranche(async (dir, commit) => {
    await commit("chore: legacy record", { "delivery/old/evidence.yaml": record(FULL, { tranche: "old", status: "ready", approved_sha: "abcdef0" }) });
    await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "merge", "-q", "--ff-only", "tranche/api");
    await sh(dir, "git", "checkout", "-qb", "tranche/next");
    const sha = await commit("feat: next", { "src/app.ts": "export const a = 5;\n" });
    await commit("chore: evidence", tranchePR("next", sha));
    expect((await validateDelivery(dir, { gate: true, base: "main" })).filter(f => f.rule_id === "delivery.approved-sha-resolves")).toEqual([]);
    // Outside the gate every ready record is judged, so the broken legacy record is still visible locally.
    expect((await validateDelivery(dir, { gate: false })).filter(f => f.rule_id === "delivery.approved-sha-resolves").map(f => f.file)).toEqual(["delivery/old/evidence.yaml"]);
  });
});

test("GLM F5: a file under the delivery root that the record does not name is drift", async () => {
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", { ...tranchePR("api", sha), "delivery/api/module.ts": "export const hidden = 1;\n" });
    const found = await gate(dir);
    expect(found).toContain("the branch changes delivery/api/module.ts under delivery/, and no record it changes names it as a report; only <tranche>/evidence.yaml records and their reports live there");
    expect(found).toContainEqual(expect.stringContaining("changes delivery/api/module.ts after approved_sha"));
  });
});

test("GLM F6: an abbreviated and a full SHA of one commit are the same approval", async () => {
  const full = "3333333aaaabbbbccccddddeeeeffff000011112";
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(FULL.map(r => r.stage === "final_review" ? { ...r, sha: full } : r), { status: "ready", approved_sha: "3333333" }) }, async dir => {
    expect((await evidence(dir)).filter(e => e.includes("is not the SHA"))).toEqual([]);
  });
});

test("GLM F10: an unreadable atdd-bun.yaml is a finding, not silence", async () => {
  await withRepo({ "atdd-bun.yaml": "delivery: [unclosed\n" }, async dir => expect(await rules(dir)).toEqual(["delivery.config-schema"]));
});

test("GLM F12: an explicit base wins over a local merge of the base into the branch", async () => {
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", tranchePR("api", sha));
    await sh(dir, "git", "checkout", "-q", "main"); await commit("main: unrelated", { "src/other.ts": "export const o = 1;\n" });
    await sh(dir, "git", "checkout", "-q", "tranche/api"); await sh(dir, "git", "merge", "-q", "--no-ff", "-m", "merge main in", "main");
    // Judged against main, the branch still brings in exactly what was approved: main's own file is not the tranche's.
    expect(await gate(dir)).toEqual([]);
    // A change to the tranche's files after approval (as a conflict resolution would make) is drift.
    await commit("fix: resolve", { "src/app.ts": "export const a = 7;\n" });
    expect(await gate(dir)).toEqual([expect.stringContaining("changes src/app.ts after approved_sha")]);
  });
});

test("GLM F9: the default claude review command allows only gates, never a writing atdd-bun subcommand", async () => {
  const skill = await Bun.file(new URL("../templates/agents/delivery/SKILL.md", import.meta.url)).text();
  const review = skill.split("\n").find(line => line.startsWith("| claude |"))!.split("|")[3];
  expect(review).not.toContain("atdd-bun:*");
  expect(review).toContain("--disallowedTools Edit Write NotebookEdit");
});

// Regressions from the Codex re-review of PR #19 (059c1ae).

test("R1: a change under the delivery root that no changed record names fails the gate, even with the record already on base", async () => {
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", tranchePR("api", sha));
    await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "merge", "-q", "--no-ff", "-m", "merge", "tranche/api");
    await sh(dir, "git", "checkout", "-qb", "tranche/smuggle");
    await commit("feat: hidden", { "delivery/api/module.ts": "export const hidden = 1;\n" });
    expect(await gate(dir)).toEqual([expect.stringContaining("changes delivery/api/module.ts under delivery/, and no record it changes names it")]);
  });
});

test("R2: a report lives in its tranche's folder, so it cannot exempt a source file from drift", async () => {
  await withRepo({ "atdd-bun.yaml": ADOPT, "src/app.ts": "x", "delivery/api/evidence.yaml": record(FULL.map(r => ({ ...r, report: "src/app.ts" }))) }, async dir => {
    expect((await evidence(dir)).filter(e => e.includes("inside delivery/api/, other than evidence.yaml"))).toHaveLength(4);
  });
  for (const report of ["delivery/api/../../src/app.ts", "delivery/api/evidence.yaml", "delivery/other/r.json"])
    await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(FULL.map((r, i) => i ? r : { ...r, report })) }, async dir => {
      expect(await evidence(dir), report).toEqual([expect.stringContaining(`report ${report} must be a data file`)]);
    });
});

test("R3: reordering or removing a model so a fallback becomes primary is a loosening", () => {
  const stages = deliveryPolicy({}).stages, base = { delivery: {} };
  expect(loosenedDelivery(base, { delivery: { stages: { ...stages, code_review: { reviewers: ["claude", "glm"] } } } })).toEqual(["delivery.stages.code_review.reviewers [glm, claude] → [claude, glm] promotes claude"]);
  expect(loosenedDelivery(base, { delivery: { stages: { ...stages, code_review: { reviewers: ["claude"] } } } })).toEqual(["delivery.stages.code_review.reviewers [glm, claude] → [claude] promotes claude"]);
  expect(loosenedDelivery(base, { delivery: { stages: { ...stages, code_review: { reviewers: ["glm"] } } } })).toEqual([]);
});

test("R4: a fallback's failures fall within the policy's window", async () => {
  const fallback = (window: Record<string, string>) => [...FULL.slice(0, 2), review("code_review", "3333333", ["glm", "a2"], ["claude", "r3"], { fallback: [{ from: "glm", kind: "rate_limit", failures: 3, window, reason: "429 on 3 attempts" }] }), FULL[3]];
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(fallback({ from: "2026-06-01T09:00:00Z", to: "2026-09-25T09:00:00Z" })) }, async dir => {
    expect(await evidence(dir)).toEqual([expect.stringContaining("the policy allows 10 (delivery.fallback.within_minutes)")]);
  });
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(fallback({ from: "2026-09-25T09:10:00Z", to: "2026-09-25T09:00:00Z" })) }, async dir => {
    expect(await evidence(dir)).toEqual([expect.stringContaining("window that ends before it starts")]);
  });
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(fallback({ from: "yesterday", to: "today" })) }, async dir => expect(await rules(dir)).toEqual(["delivery.evidence-schema", "delivery.evidence-schema"]));
});

// Regressions from the GLM re-review of PR #19 (059c1ae). Its R3 and R4 repeat Codex's R1 and R2, covered above.

test("GLM R1: tightening the policy later does not fail every change on a record that merged under the old one", async () => {
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", tranchePR("api", sha));   // code_review: glm reviewed glm, legal under fresh-process
    await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "merge", "-q", "--no-ff", "-m", "merge", "tranche/api");
    await commit("chore: tighten", { "atdd-bun.yaml": "profiles: [delivery]\ndelivery:\n  root: delivery\n  stages:\n    plan_review: { reviewers: [glm, claude] }\n    test_review: { reviewers: [codex, claude] }\n    code_review: { reviewers: [glm, claude], independence: different-model }\n    final_review: { reviewers: [codex, claude] }\n" });
    await sh(dir, "git", "checkout", "-qb", "tranche/next");
    const next = await commit("feat: next", { "src/app.ts": "export const a = 3;\n" });
    const record = tranchePR("next", next);
    record["delivery/next/evidence.yaml"] = record["delivery/next/evidence.yaml"].replace('"run":"a2"}', '"run":"a2"}').replace(/"reviewer":\{"model":"glm","run":"r3"\}/, '"reviewer":{"model":"claude","run":"r3"},"fallback":[{"from":"glm","kind":"outage","failures":3,"window":{"from":"2026-09-25T09:00:00Z","to":"2026-09-25T09:05:00Z"},"reason":"provider outage all morning"}]');
    await commit("chore: evidence", record);
    expect(await validateDelivery(dir, { gate: true, base: "main" })).toEqual([]);
    // Outside the gate the old record is judged against today's policy, so the history stays visible.
    expect((await validateDelivery(dir, { gate: false })).map(f => `${f.rule_id} ${f.file}`)).toEqual(["delivery.reviewer-independent delivery/api/evidence.yaml"]);
  });
});

test("GLM R2: the post-merge gate judges everything a push brings in, not only its last commit", async () => {
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", tranchePR("api", sha));
    await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "merge", "-q", "--no-ff", "-m", "merge", "tranche/api");
    const before = await sh(dir, "git", "rev-parse", "HEAD");
    await sh(dir, "git", "rm", "-rq", "delivery/api"); await commit("direct: rewrite and erase", { "src/app.ts": "export const a = 99;\n" });
    await sh(dir, "git", "commit", "-q", "--allow-empty", "-m", "direct: cover");
    const judged = async (base?: string) => (await validateDelivery(dir, { gate: "post-merge", base })).filter(f => f.rule_id === "delivery.merge-gate").map(f => f.evidence);
    expect(await judged()).toEqual([]);   // one commit deep: the empty tip hides the push
    const found = await judged(before);
    expect(found).toContain("this push deletes delivery/api/evidence.yaml; records are append-only, and deleting one would escape its findings and the gate");
    expect(found).toContainEqual(expect.stringContaining("this push changes src/app.ts with no tranche record"));   // a deleted record covers nothing
    expect(found).toContainEqual(expect.stringContaining("changes delivery/api/final_review.json under delivery/"));
    expect(await judged("0000000000000000000000000000000000000000")).toEqual([]);   // a new branch's first push falls back to the parent
  });
});

// Regressions from round 3 of PR #19 (Codex, 64a07fb).

test("T1: an evidence.yaml at any depth other than <root>/<tranche>/ covers nothing", async () => {
  for (const decoy of ["delivery/evidence.yaml", "delivery/x/y/evidence.yaml"])
    await tranche(async (dir, commit) => {
      await commit("feat: pwn", { "src/pwn.ts": "export const p = 1;\n", [decoy]: "anything: true\n" });
      const found = await gate(dir);
      expect(found, decoy).toContainEqual(expect.stringContaining(`changes ${decoy} under delivery/`));
      expect(found, decoy).toContainEqual(expect.stringContaining("changes src/pwn.ts with no tranche record"));
    });
});

test("T2: a push that adds code alongside a record approving an older commit drifts after the merge too", async () => {
  await tranche(async (dir, commit) => {
    const old = await sh(dir, "git", "rev-parse", "main");
    await sh(dir, "git", "checkout", "-q", "main");
    const before = await sh(dir, "git", "rev-parse", "HEAD");
    await commit("direct: pwn", { "src/pwn.ts": "export const p = 1;\n", ...tranchePR("api", old) });
    expect((await validateDelivery(dir, { gate: "post-merge", base: before })).filter(f => f.rule_id === "delivery.merge-gate").map(f => f.evidence))
      .toEqual([expect.stringContaining("this push changes src/pwn.ts after approved_sha")]);
  });
});

test("T4: every stage approves a real commit in the approved history, in lifecycle order", async () => {
  await tranche(async (dir, commit) => {
    const plan = await commit("plan", { "plan/a.yaml": "a: 1\n" }), red = await commit("red", { "tests/a.test.ts": "//\n" }), green = await commit("green", { "src/app.ts": "export const a = 3;\n" });
    const shas: Record<string, string> = { plan_review: plan, test_review: red, code_review: green, final_review: green };
    const write = async (overrides: Record<string, string>) => {
      await mkdir(join(dir, "delivery/api"), { recursive: true });
      const reviews = FULL.map(r => ({ ...r, sha: overrides[r.stage as string] ?? shas[r.stage as string], report: `delivery/api/${r.stage}.json` }));
      await writeFile(join(dir, "delivery/api/evidence.yaml"), record(reviews, { status: "ready", approved_sha: green }));
      for (const r of FULL) await writeFile(join(dir, `delivery/api/${r.stage}.json`), "{}");
      return (await validateDelivery(dir, { gate: false })).filter(f => f.rule_id === "delivery.approved-sha-resolves").map(f => f.evidence);
    };
    expect(await write({})).toEqual([]);
    expect(await write({ plan_review: "0000000" })).toEqual(["plan_review approved 0000000, which is not a commit in this repository's history"]);
    // A commit off the approved history, made without touching the record files.
    const side = await sh(dir, "git", "commit-tree", "-p", "main", "-m", "side", `${await sh(dir, "git", "rev-parse", "main")}^{tree}`);
    expect(await write({ test_review: side })).toEqual([expect.stringContaining("which is not in the history of approved_sha")]);
    expect(await write({ plan_review: red, test_review: plan })).toEqual([expect.stringContaining("test_review approved")]);
  });
});

// Round 3 of PR #19 (GLM, 64a07fb).

test("GLM T1: a wrong-typed policy value is a config finding, never a crash, in the validator and the integrity check", async () => {
  for (const policy of ["delivery:\n  root: 123\n", "delivery:\n  root: delivery\n  stages:\n    code_review: { reviewers: glm }\n", "delivery:\n  root: delivery\n  fallback: { after_failures: many }\n", "delivery: 7\n"])
    await withRepo({ "atdd-bun.yaml": policy, "delivery/api/evidence.yaml": record(FULL) }, async dir => expect(await rules(dir), policy).toContain("delivery.config-schema"));
  expect(() => loosenedDelivery({ delivery: {} }, { delivery: { root: 123, stages: { code_review: { reviewers: "glm" } } } })).not.toThrow();
  expect(deliveryPolicy({ root: 123 }).root).toBe("docs/delivery/tranches");
});

test("GLM T2: the skill's example record is a state the profile accepts", async () => {
  const skill = await Bun.file(new URL("../templates/agents/delivery/SKILL.md", import.meta.url)).text();
  const example = Bun.YAML.parse(skill.split("```yaml\n")[1].split("```")[0]) as Record<string, unknown>;
  await withRepo({ "atdd-bun.yaml": "profiles: [delivery]\n", "docs/delivery/tranches/api/evidence.yaml": JSON.stringify(example) }, async dir => expect(await rules(dir)).toEqual([]));
});

// Round 4 of PR #19 (Codex, 6779137).

test("U1: a record or report already on the base branch is final; editing it cannot exempt a report from drift", async () => {
  await tranche(async (dir, commit) => {
    const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
    await commit("chore: evidence", tranchePR("api", sha));
    await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "merge", "-q", "--no-ff", "-m", "merge", "tranche/api");
    await sh(dir, "git", "checkout", "-qb", "tranche/abuse");
    const old = await Bun.file(join(dir, "delivery/api/evidence.yaml")).text();
    await commit("abuse", { "delivery/api/final_review.json": "{\"allow\": \"everyone\"}\n", "delivery/api/evidence.yaml": old.replace('"status":"ready"', '"status":"ready","pr":"touched"') });
    const found = await gate(dir);
    expect(found).toContain("the branch modifies delivery/api/evidence.yaml, which is already on the base branch; merged records and reports are final, so a later change needs a new tranche");
    expect(found).toContain("the branch modifies delivery/api/final_review.json, which is already on the base branch; merged records and reports are final, so a later change needs a new tranche");
  });
});

test("U2: an explicit `delivery: null` is validated as written, not read as an empty block", async () => {
  await withRepo({ "atdd-bun.yaml": "profiles: [delivery]\ndelivery: null\n", "docs/delivery/tranches/api/evidence.yaml": record(FULL) }, async dir => expect(await rules(dir)).toEqual(["delivery.config-schema"]));
  await withRepo({ "atdd-bun.yaml": "profiles: [delivery]\n", "docs/delivery/tranches/api/evidence.yaml": record(FULL) }, async dir => expect(await rules(dir)).toEqual([]));
});

// Round 4 of PR #19 (GLM, 6779137).

test("GLM U1: two ready tranches in one change do not drift against each other", async () => {
  await tranche(async (dir, commit) => {
    const a = await commit("feat: a", { "src/a.ts": "export const a = 1;\n" });
    await commit("chore: a evidence", tranchePR("a", a));
    await sh(dir, "git", "checkout", "-q", "-b", "tranche/b", "main");
    const b = await commit("feat: b", { "src/b.ts": "export const b = 1;\n" });
    await commit("chore: b evidence", tranchePR("b", b));
    // One PR carrying both tranches.
    await sh(dir, "git", "checkout", "-q", "tranche/api"); await sh(dir, "git", "merge", "-q", "--no-ff", "-m", "both", "tranche/b");
    expect(await gate(dir)).toEqual([]);
    // One push to main bringing both (a merge-queue batch).
    await sh(dir, "git", "checkout", "-q", "main"); const before = await sh(dir, "git", "rev-parse", "HEAD");
    await sh(dir, "git", "merge", "-q", "--no-ff", "-m", "batch", "tranche/api");
    expect((await validateDelivery(dir, { gate: "post-merge", base: before })).filter(f => f.rule_id === "delivery.merge-gate")).toEqual([]);
    // An unreviewed file in the same batch is still drift for whichever record the batch side belongs to.
    await sh(dir, "git", "reset", "-q", "--hard", before); await sh(dir, "git", "checkout", "-q", "tranche/api");
    await commit("sneak", { "src/c.ts": "export const c = 1;\n" });
    expect(await gate(dir)).toContainEqual(expect.stringContaining("changes src/c.ts after approved_sha"));
  });
});

test("GLM U2: renaming a merged record away is a deletion", async () => {
  for (const target of ["archive/evidence.yaml", "delivery/api2/moved.json"])
    await tranche(async (dir, commit) => {
      const sha = await commit("feat: api", { "src/app.ts": "export const a = 2;\n" });
      await commit("chore: evidence", tranchePR("api", sha));
      await sh(dir, "git", "checkout", "-q", "main"); await sh(dir, "git", "merge", "-q", "--no-ff", "-m", "merge", "tranche/api");
      await sh(dir, "git", "checkout", "-qb", "tranche/move");
      await mkdir(dirname(join(dir, target)), { recursive: true }); await sh(dir, "git", "mv", "delivery/api/evidence.yaml", target);
      const next = await commit("move", { "src/app.ts": "export const a = 4;\n" });
      await commit("chore: api2", tranchePR("api2", next));
      expect(await gate(dir), target).toContain("the branch deletes delivery/api/evidence.yaml; records are append-only, and deleting one would escape its findings and the gate");
    });
});

test("GLM U3: code changed after code_review cannot merge on an appended final_review alone", async () => {
  await tranche(async (dir, commit) => {
    const green = await commit("green", { "src/app.ts": "export const a = 2;\n" });
    const later = await commit("after code review", { "src/app.ts": "export const a = 666;\n" });
    const reviews = FULL.map(r => ({ ...r, sha: r.stage === "final_review" ? later : green, report: `delivery/api/${r.stage}.json` }));
    await commit("evidence", { "delivery/api/evidence.yaml": record(reviews, { status: "ready", approved_sha: later }), ...Object.fromEntries(FULL.map(r => [`delivery/api/${r.stage}.json`, "{}"])) });
    expect((await validateDelivery(dir, { gate: false })).map(f => f.evidence)).toEqual([`src/app.ts changed after code_review approved ${green.slice(0, 7)}, and only final_review reviewed the change; a code change goes back through code_review`]);
  });
});

// Round 5 of PR #19 (Codex, 7804950).

test("V1: the delivery root may not overlap a plan, source, test, e2e or telemetry root, and reports are data files", async () => {
  for (const root of ["src", "src/wagons", "src/wagons/delivery", "plan", "tests/wagons/x"])
    await withRepo({ "atdd-bun.yaml": `delivery:\n  root: ${root}\n` }, async dir => expect(await evidence(dir), root).toContainEqual(expect.stringContaining(`delivery.root ${root} overlaps`)));
  await withRepo({ "atdd-bun.yaml": "delivery:\n  root: ops/delivery\n" }, async dir => expect(await rules(dir)).toEqual([]));
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(FULL.map((r, i) => i ? r : { ...r, report: "delivery/api/new.ts" })) }, async dir => {
    expect(await evidence(dir)).toEqual([expect.stringContaining("report delivery/api/new.ts must be a data file")]);
  });
});

test("V2: every review retains its own report, as a regular file", async () => {
  const same = FULL.map(r => ({ ...r, report: "delivery/api/report.json" }));
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/report.json": "{}", "delivery/api/evidence.yaml": record(same, { status: "ready", approved_sha: "3333333" }) }, async dir => {
    expect((await evidence(dir)).filter(e => e.includes("reuses report"))).toHaveLength(3);
  });
  const dirs = FULL.map(r => ({ ...r, report: `delivery/api/${r.stage}.json` }));
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(dirs, { status: "ready", approved_sha: "3333333" }), ...Object.fromEntries(FULL.map(r => [`delivery/api/${r.stage}.json/inner.txt`, "x"])) }, async dir => {
    expect((await evidence(dir)).filter(e => e.includes("is not a regular file"))).toHaveLength(4);
  });
});

// Round 5 of PR #19 (GLM, 7804950; approved with two low findings).

test("GLM V1: a symlinked tranche folder is reported, never skipped unread", async () => {
  await withRepo({ "atdd-bun.yaml": ADOPT, "stash/evidence.yaml": record(FULL, { status: "ready", approved_sha: "3333333" }) }, async dir => {
    await mkdir(join(dir, "delivery"), { recursive: true });
    await Bun.$`ln -s ../stash ${join(dir, "delivery/x")}`;
    expect(await evidence(dir)).toEqual(["delivery/x is a symlink; a tranche folder is a real folder holding its own evidence.yaml"]);
  });
});

test("GLM V2: the check after code_review covers the whole repository, whatever the scan root", async () => {
  await tranche(async (dir, commit) => {
    const green = await commit("green", { "svc/api/src/app.ts": "export const a = 2;\n" });
    const later = await commit("elsewhere", { "svc/web/x.ts": "export const x = 1;\n" });
    await writeFile(join(dir, "svc/api/atdd-bun.yaml"), ADOPT);
    const reviews = FULL.map(r => ({ ...r, sha: r.stage === "final_review" ? later : green, report: `delivery/api/${r.stage}.json` }));
    await commit("evidence", { "svc/api/delivery/api/evidence.yaml": record(reviews, { status: "ready", approved_sha: later }), ...Object.fromEntries(FULL.map(r => [`svc/api/delivery/api/${r.stage}.json`, "{}"])) });
    expect((await validateDelivery(join(dir, "svc/api"), { gate: false })).map(f => f.evidence)).toEqual([expect.stringContaining("svc/web/x.ts changed after code_review approved")]);
  });
});

// Round 6 of PR #19 (GLM, 4796c29; approved with one medium and four low findings).

test("GLM W1: the freshness check follows code_review, so a reduced stage set can still become ready", async () => {
  await tranche(async (dir, commit) => {
    const plan = await commit("plan", { "plan/a.yaml": "a: 1\n" }), code = await commit("code", { "src/app.ts": "export const a = 3;\n" });
    const stages = (names: string[]) => `delivery:\n  root: delivery\n  stages:\n${names.map(n => `    ${n}: { reviewers: [${n === "test_review" || n === "final_review" ? "codex" : "glm"}, claude] }`).join("\n")}\n`;
    const check = async (names: string[], shas: Record<string, string>, approved: string) => {
      const reviews = FULL.filter(r => names.includes(r.stage as string)).map(r => ({ ...r, sha: shas[r.stage as string], report: `delivery/api/${r.stage}.json` }));
      await mkdir(join(dir, "delivery/api"), { recursive: true });
      await writeFile(join(dir, "atdd-bun.yaml"), stages(names));
      await writeFile(join(dir, "delivery/api/evidence.yaml"), record(reviews, { status: "ready", approved_sha: approved }));
      for (const r of reviews) await writeFile(join(dir, r.report as string), "{}");
      return (await validateDelivery(dir, { gate: false })).map(f => f.evidence);
    };
    expect(await check(["plan_review", "code_review"], { plan_review: plan, code_review: code }, code)).toEqual([]);
    expect(await check(["code_review"], { code_review: code }, code)).toEqual([]);
    // With final_review configured, code after code_review is still caught.
    expect(await check(["code_review", "final_review"], { code_review: plan, final_review: code }, code)).toEqual([expect.stringContaining("changed after code_review approved")]);
  });
});

test("GLM W2: generated delivery skill files stay protected while present, even with delivery turned off", async () => {
  const { checkIntegrity } = await import("../src/integrity");
  const { agentInit } = await import("../src/agent");
  const { initializeRepository } = await import("../src/setup");
  const root = await mkdtemp(join(tmpdir(), "atdd-w2-"));
  try {
    await sh(root, "git", "init", "-q", "-b", "work");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "app", devDependencies: { "@afokapu/atdd-bun": "^0.7.0" } }));
    await writeFile(join(root, "bun.lock"), `{\n  "packages": {\n    "@afokapu/atdd-bun": ["@afokapu/atdd-bun@0.7.0", "", { "bin": { "atdd-bun": "src/cli.ts" } }, "sha512-abc=="],\n  }\n}\n`);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [traceability, delivery]\n");
    expect((await initializeRepository(root)).ok).toBeTrue();
    expect((await agentInit(root, true)).ok).toBeTrue();
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [traceability]\n");
    const review = join(root, ".claude/skills/delivery/review.md");
    await writeFile(review, "Edit freely.\n");
    expect((await checkIntegrity({ root })).map(f => f.file)).toEqual([".claude/skills/delivery/review.md"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("GLM W3: an explicit gate base that cannot be resolved fails closed in both modes", async () => {
  await tranche(async (dir, commit) => {
    await commit("a first commit on the branch, so the pushed tip has a parent", { "src/x.ts": "export const x = 1;\n" });
    for (const gate of [true, "post-merge"] as const)
      expect((await validateDelivery(dir, { gate, base: "1234567890abcdef1234567890abcdef12345678" })).map(f => f.evidence), String(gate)).toEqual([expect.stringContaining("cannot resolve the base branch")]);
    expect((await validateDelivery(dir, { gate: "post-merge", base: "0".repeat(40) })).filter(f => f.evidence.includes("cannot resolve"))).toEqual([]);   // a new branch
  });
});

test("GLM W4 and W5: changed commands and when_exhausted are loosening; a removed list is reported once", () => {
  const base = { delivery: { commands: { claude: { review: "claude -p --allowedTools Read" } } } };
  expect(loosenedDelivery(base, { delivery: { commands: { claude: { review: "claude -p --dangerously-skip-permissions" } } } })).toEqual(["delivery.commands.claude.review changed"]);
  expect(loosenedDelivery(base, { delivery: {} })).toEqual([]);   // back to the protected default
  // Codex round 7 (X1): overriding a default where the base set nothing is reported too.
  expect(loosenedDelivery({ profiles: ["delivery"] }, { profiles: ["delivery"], delivery: { commands: { claude: { review: "claude -p --dangerously-skip-permissions" } } } })).toEqual(["delivery.commands.claude.review overrides the default"]);
  expect(loosenedDelivery({ delivery: {} }, { delivery: { fallback: { when_exhausted: "wait" } } })).toEqual(["delivery.fallback.when_exhausted block → wait"]);
  expect(loosenedPolicy({ profiles: ["delivery", "docs"] }, {}).filter(line => line.includes("delivery"))).toEqual(["profiles becomes implicit: the explicit list [delivery, docs] was removed"]);
});

// The default root: records live in the docs profile's delivery area, which leaves the records folder to this profile.

test("by default, tranche records live under docs/delivery/tranches", async () => {
  expect(deliveryPolicy({}).root).toBe("docs/delivery/tranches");
  await withRepo({ "atdd-bun.yaml": "profiles: [delivery]\n", "docs/delivery/tranches/api/evidence.yaml": record(FULL, { tranche: "web" }) }, async dir => {
    expect(await evidence(dir)).toEqual(["tranche 'web' does not match its folder 'api'"]);
  });
});

test("where delivery is adopted, the docs profile leaves the records folder to it, and only that folder", async () => {
  const { scanDocumentation, declarationViolations } = await import("../src/docs-capability");
  const files = {
    "docs/index.adoc": "= Docs\n:doc-id: docs\n:status: current\n",
    "docs/delivery/index.adoc": "= Program\n:doc-id: program\n:status: current\n",
    "docs/delivery/tranches/api/code_review.md": "# raw reviewer output\n",
    "docs/delivery/notes.md": "# authored markdown outside the records folder\n",
  };
  const markdown = async (dir: string) => (await scanDocumentation(dir)).filter(v => v.rule_id === "planner.docs.asciidoc-only").map(v => v.file).sort();
  await withRepo({ ...files, "atdd-bun.yaml": "profiles: [docs, delivery]\n" }, async dir => expect(await markdown(dir)).toEqual(["docs/delivery/notes.md"]));
  await withRepo({ ...files, "atdd-bun.yaml": "profiles: [docs]\n" }, async dir => expect(await markdown(dir)).toEqual(["docs/delivery/notes.md", "docs/delivery/tranches/api/code_review.md"]));
  // A change to a record needs no docs declaration; a change to the program's reasoning still does.
  const records = (path: string) => path.startsWith("docs/delivery/tranches/");
  const undeclared = declarationViolations({ impact: "none", artifacts: [] } as never, ["docs/delivery/tranches/api/evidence.yaml", "docs/delivery/index.adoc"], records).map(v => v.file);
  expect(undeclared).toEqual(["docs/delivery/index.adoc"]);
  // The same through checkDocumentation, which finds the records folder from atdd-bun.yaml.
  const { checkDocumentation } = await import("../src/docs-capability");
  await withRepo({ ...files, "atdd-bun.yaml": "profiles: [docs, delivery]\n" }, async dir => {
    const check = await checkDocumentation({ root: dir, declaration: { impact: "change", artifacts: [{ action: "modify", path: "docs/index.adoc" }] } as never, changeSet: ["docs/delivery/tranches/api/evidence.yaml", "docs/delivery/index.adoc"], render: async () => ({ findings: [] }) });
    expect(check.findings.filter(f => f.rule_id === "planner.docs.undeclared-change").map(f => (f as { file: string }).file)).toEqual(["docs/delivery/index.adoc"]);
  });
});

test("records left under delivery/, the 0.8.0 default, are reported rather than silently unseen", async () => {
  await withRepo({ "atdd-bun.yaml": "profiles: [delivery]\n", "delivery/api/evidence.yaml": record(FULL) }, async dir => {
    expect(await evidence(dir)).toEqual([expect.stringContaining("tranche records under delivery/ (api) are outside the default root docs/delivery/tranches")]);
  });
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(FULL) }, async dir => expect(await rules(dir)).toEqual([]));   // root pinned
});

test("inside docs/, the only delivery root is docs/delivery/tranches, and the docs profile gives up nothing else", async () => {
  const { scanDocumentation } = await import("../src/docs-capability");
  for (const root of ["docs", "docs/purpose", "docs/delivery"]) {
    const files = { "atdd-bun.yaml": `profiles: [docs, delivery]\ndelivery:\n  root: ${root}\n`, "docs/index.adoc": "= D\n:doc-id: d\n:status: current\n", [`${root}/api/report.md`]: "# authored markdown\n" };
    await withRepo(files, async dir => {
      expect(await evidence(dir), root).toContainEqual(expect.stringContaining(`delivery.root ${root} is inside docs/`));
      expect((await scanDocumentation(dir)).filter(v => v.rule_id === "planner.docs.asciidoc-only").map(v => v.file), root).toEqual([`${root}/api/report.md`]);
    });
  }
  await withRepo({ "atdd-bun.yaml": "delivery:\n  root: ops/delivery\n" }, async dir => expect(await rules(dir)).toEqual([]));
});

test("every root change after adoption is a loosening, including pinning the 0.8.0 root (Codex round 3 of #23)", () => {
  expect(loosenedDelivery({ profiles: ["delivery"] }, { profiles: ["delivery"], delivery: { root: "delivery" } })).toEqual(["delivery.root docs/delivery/tranches → delivery"]);
  expect(loosenedDelivery({ profiles: ["delivery"] }, { profiles: ["delivery"], delivery: { root: "ops/records" } })).toEqual(["delivery.root docs/delivery/tranches → ops/records"]);
  expect(loosenedDelivery({ delivery: { root: "docs/delivery/tranches" } }, { delivery: { root: "delivery" } })).toEqual(["delivery.root docs/delivery/tranches → delivery"]);
});

// Round 2 of #23 (Codex R1 high, GLM R1 medium and R2 low).

test("the records folder holds only records and data: authored AsciiDoc there is reported by delivery and stays under the docs rules", async () => {
  const { scanDocumentation } = await import("../src/docs-capability");
  await withRepo({
    "atdd-bun.yaml": "profiles: [docs, delivery]\n", "docs/index.adoc": "= D\n:doc-id: d\n:status: current\n",
    "docs/delivery/tranches/api/evidence.yaml": record([]), "docs/delivery/tranches/api/hidden.adoc": "= Hidden\n",
    "docs/delivery/tranches/api/tool.ts": "export {};\n", "docs/delivery/tranches/loose.json": "{}",
  }, async dir => {
    expect((await validateDelivery(dir, { gate: false })).filter(f => f.rule_id === "delivery.evidence-schema").map(f => f.file)).toEqual([
      "docs/delivery/tranches/api/hidden.adoc", "docs/delivery/tranches/api/tool.ts", "docs/delivery/tranches/loose.json",
    ]);
    expect((await scanDocumentation(dir)).filter(v => v.rule_id === "planner.docs.identity-required").map(v => v.file)).toEqual(["docs/delivery/tranches/api/hidden.adoc"]);
  });
});

test("records under the default root while another root is configured are reported, so the legacy pin cannot hide them", async () => {
  await withRepo({ "atdd-bun.yaml": "profiles: [delivery]\ndelivery:\n  root: delivery\n", "docs/delivery/tranches/api/evidence.yaml": record(FULL) }, async dir => {
    expect(await evidence(dir)).toEqual([expect.stringContaining("tranche records under docs/delivery/tranches (api) are outside the configured root delivery")]);
  });
});
