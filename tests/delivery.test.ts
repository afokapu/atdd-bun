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

test("the multiplexer is named in the policy, herdr by default, any command name accepted", async () => {
  expect(deliveryPolicy({}).multiplexer).toBe("herdr");
  expect(deliveryPolicy({ multiplexer: "tmux" }).multiplexer).toBe("tmux");
  await withRepo({ "atdd-bun.yaml": "delivery:\n  multiplexer: zellij\n", "delivery/api/evidence.yaml": record(FULL) }, async dir => expect(await rules(dir)).toEqual([]));
  await withRepo({ "atdd-bun.yaml": "delivery:\n  multiplexer: Herdr CLI\n", "delivery/api/evidence.yaml": record(FULL) }, async dir => expect(await rules(dir)).toEqual(["delivery.config-schema"]));
});

test("a malformed policy is reported and the evidence is judged against the defaults", async () => {
  await withRepo({ "atdd-bun.yaml": "delivery:\n  stages:\n    code_review: { reviewers: [] }\n", "delivery/api/evidence.yaml": record(FULL) }, async dir => {
    expect(await rules(dir)).toEqual(["delivery.config-schema"]);
  });
});

test("stages the policy omits are not required, and a review of one is out of policy", async () => {
  const policy = "delivery:\n  stages:\n    code_review: { reviewers: [claude] }\n";
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
  const recorded = [...FULL.slice(0, 2), review("code_review", "3333333", ["glm", "a2"], ["claude", "r3"], { fallback: [{ from: "glm", kind: "rate_limit", failures: 3, reason: "rate limit: 3 failures in 10 minutes" }] }), FULL[3]];
  await withRepo({ "atdd-bun.yaml": ADOPT, "delivery/api/evidence.yaml": record(recorded) }, async dir => expect(await rules(dir)).toEqual([]));
  // An author fallback is recorded under its own role: a reviewer fallback does not excuse it.
  const author = [...FULL.slice(0, 2), review("code_review", "3333333", ["claude", "a2"], ["glm", "r3"], { fallback: [{ from: "glm", kind: "outage", failures: 3, reason: "provider outage since 09:00" }] }), FULL[3]];
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
// A ready record retains every review's raw output next to it.
const tranchePR = (tranche: string, sha: string, status = "ready") => ({
  [`delivery/${tranche}/evidence.yaml`]: record(FULL.map(r => ({ ...(r.stage === "final_review" ? { ...r, sha } : r), report: `delivery/${tranche}/${r.stage}.json` })), { tranche, status, approved_sha: sha }),
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
    expect((await validateDelivery(dir, { gate: true, base: "does-not-exist" })).filter(f => f.rule_id === "delivery.merge-gate")).toEqual([]);
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
    await commit("chore: opt out", { "atdd-bun.yaml": "profiles: [delivery]\ndelivery:\n  require_record: false\n" });
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
  expect(loosenedDelivery(base, { delivery: { root: "unused" } })).toEqual(["delivery.root delivery → unused"]);
  expect(loosenedDelivery(base, { delivery: { stages: { ...deliveryPolicy({}).stages, plan_review: { authors: ["codex", "gpt"], reviewers: ["glm", "claude"] } } } })).toEqual(["delivery.stages.plan_review.authors adds gpt"]);
  expect(loosenedDelivery(base, { delivery: { fallback: { after_failures: 1, within_minutes: 60 } } })).toEqual(["delivery.fallback.after_failures 3 → 1", "delivery.fallback.within_minutes 10 → 60"]);
  expect(loosenedDelivery(base, { delivery: { fallback: { after_failures: 5, within_minutes: 5 } } })).toEqual([]);
});

test("F4: a fallback states a kind of unavailability and at least the policy's failure count", async () => {
  const fallback = (entry: Record<string, unknown>) => [...FULL.slice(0, 2), review("code_review", "3333333", ["glm", "a2"], ["claude", "r3"], { fallback: [{ from: "glm", reason: "the reviewer requested changes", ...entry }] }), FULL[3]];
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
      "status is ready, but reviews[2] (code_review) names report delivery/api/gone.json, which does not exist",
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
