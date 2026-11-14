// URN: test:toolkit:staged-file-exception-atomic-ledger:E001-UNIT-001-bound-test-file
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { installHooks, runHook, startWorktree } from "../src/hooks";

/**
 * RED: the owner-authorized single-use ledger transition must be atomic and fail closed.
 * Defect (0.10.117): post-commit deleted `pending.yaml` before it validated HEAD or published `consumed.yaml`,
 * so a failed validation or I/O error destroyed the pending authorization and the ledger never recorded the
 * consumption. Everything below uses isolated fixtures: no Score live state, archive, bookmarks, or authorization record.
 * Authorization: M-20261104T155526Z-owner-authorization_3fd46f1c; evidence: M-20261104T120517Z-atomic-decision-evidence_a871b6f0.
 */
const OWNER_AUTHORIZATION = "M-20261104T155526Z-owner-authorization_3fd46f1c";
const DECISION_EVIDENCE = "M-20261104T120517Z-atomic-decision-evidence_a871b6f0";
const SCHEMA = "atdd-bun.staged-file-limit-exception/v1";
const PRESERVED = /pending authorization preserved/;

const inventory = [
  "contracts/score-provider/v1/inspection/descriptor.json",
  "contracts/score-provider/v1/inspection/fixture.json",
  "contracts/score-provider/v1/inspection/integrity.json",
  "contracts/score-provider/v1/manifest.json",
  "contracts/score-provider/v1/schemas.json",
  "docs/purpose/journeys/index.adoc",
  "docs/purpose/journeys/svg/journey-control-assessment.svg",
  "docs/purpose/journeys/svg/path-control-assessment-nominal.svg",
  "docs/purpose/journeys/svg/train-score-evaluate-control-refused.svg",
  "docs/purpose/journeys/svg/train-score-evaluate-control-technical-failure.svg",
  "docs/purpose/journeys/svg/train-score-evaluate-control.svg",
  "e2e/interlockings/control-assessment/control-nominal.routes.test.ts",
  "e2e/interlockings/control-assessment/control-refused.routes.test.ts",
  "e2e/interlockings/control-assessment/control-technical-failure.routes.test.ts",
  "plan/_journeys/control-assessment.yaml",
  "plan/_themes.yaml",
  "plan/_trains.yaml",
  "plan/_trains/_interlockings/control-assessment.yaml",
  "plan/_trains/train:score:evaluate-control-refused.yaml",
  "plan/_trains/train:score:evaluate-control-technical-failure.yaml",
  "plan/_trains/train:score:evaluate-control.yaml",
  "plan/control/_control.yaml",
  "plan/control/assess-joint-feasibility.yaml",
  "plan/control/C001.yaml",
  "plan/control/D001.yaml",
  "plan/control/E001.yaml",
  "plan/control/estimate-respite.yaml",
  "plan/control/estimate-response-time.yaml",
  "plan/control/evaluate-required-predicates.yaml",
  "plan/control/P001.yaml",
  "plan/control/publish-control-diagnostics.yaml",
  "plan/control/R001.yaml",
  "plan/control/Y001.yaml",
  "src/composition.ts",
  "src/wagons/control/features/assess-joint-feasibility/domain/canonical-joint-feasibility.ts",
  "src/wagons/control/features/estimate-respite/domain/canonical-respite.ts",
  "src/wagons/control/features/estimate-response-time/domain/canonical-response-time.ts",
  "src/wagons/control/features/evaluate-required-predicates/application/evaluate-control.ts",
  "src/wagons/control/features/evaluate-required-predicates/domain/canonical-vector.ts",
  "src/wagons/control/features/publish-control-diagnostics/application/publish-control-diagnostics.ts",
  "tests/fixtures/decision-control-evaluator/v1/canonical-vector.json",
  "tests/trains/score:evaluate-control/canonical-routes.test.ts",
  "tests/wagons/commons/features/measured-aspect/unit/provider-inspection-descriptor.contract.test.ts",
  "tests/wagons/commons/features/measured-aspect/unit/provider-manifest.contract.test.ts",
  "tests/wagons/control/features/assess-joint-feasibility/unit/canonical-joint-feasibility.test.ts",
  "tests/wagons/control/features/estimate-respite/unit/canonical-timeliness.test.ts",
  "tests/wagons/control/features/estimate-response-time/unit/canonical-response-time.test.ts",
  "tests/wagons/control/features/evaluate-required-predicates/unit/canonical-vector.test.ts",
  "tests/wagons/control/features/evaluate-required-predicates/unit/noncanonical.test.ts",
  "tests/wagons/control/features/publish-control-diagnostics/integration/publish-control-diagnostics.test.ts",
];

const run = async (cwd: string, cmd: string[]) => {
  const child = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out: out.trim(), err: err.trim() };
};
const must = async (cwd: string, cmd: string[]) => { const result = await run(cwd, cmd); if (result.code) throw new Error(`${cmd.join(" ")} failed in ${cwd}: ${result.err || result.out}`); return result.out; };
const git = (cwd: string, ...args: string[]) => must(cwd, ["git", ...args]);
const jj = (cwd: string, ...args: string[]) => must(cwd, ["jj", ...args]);
const inventoryHash = (paths: string[]) => new Bun.CryptoHasher("sha256").update([...paths].sort().join("\n")).digest("hex");
const record = () => ({ schema: SCHEMA, project: "score-os", task: "wagon-control-implementation-v2", scope: "staged-file-count", owner_authorization: OWNER_AUTHORIZATION, decision_evidence: DECISION_EVIDENCE, inventory: [...inventory], inventory_sha256: inventoryHash(inventory) });
const policyText = "profiles: [security]\nmax_staged_files: 20\nrequire_traceability: false\n";

type Fixture = { container: string; root: string; cleanup: () => Promise<void> };
const ledger = async (root: string) => join(resolve(root, await git(root, "rev-parse", "--git-common-dir")), "atdd-bun", "staged-file-limit-exception");
const pendingFile = async (root: string) => join(await ledger(root), "pending.yaml");
const consumedFile = async (root: string) => join(await ledger(root), "consumed.yaml");
const exists = async (file: Promise<string>) => existsSync(await file);
const consumedRecord = async (root: string) => Bun.YAML.parse(await readFile(await consumedFile(root), "utf8")) as Record<string, unknown>;

async function authorize(root: string) {
  const directory = await ledger(root);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "authorization.yaml"), JSON.stringify(record()));
}
async function writeInventory(root: string) {
  for (const path of inventory) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), `content of ${path}\n`); }
}
const stageInventory = (root: string) => git(root, "add", "--", ...inventory);

async function gitFixture(): Promise<Fixture> {
  const container = await realpath(await mkdtemp(join(tmpdir(), "atdd-bun-ledger-git-"))), root = join(container, "repository");
  await mkdir(root);
  for (const args of [["init", "-q", "-b", "feature"], ["config", "user.email", "ledger@test"], ["config", "user.name", "Ledger"]]) await git(root, ...args);
  await writeFile(join(root, "atdd-bun.yaml"), policyText); await writeFile(join(root, "readme.md"), "init\n");
  await git(root, "add", "."); await git(root, "commit", "-qm", "init", "--no-verify");
  await writeFile(join(root, ".git", "info", "exclude"), "node_modules/\n.githooks/\n");
  await mkdir(join(root, "node_modules", "@afokapu"), { recursive: true });
  await symlink(resolve(import.meta.dir, ".."), join(root, "node_modules", "@afokapu", "atdd-bun"), "dir");
  expect((await installHooks(root)).ok).toBeTrue();
  await writeInventory(root); await authorize(root); await stageInventory(root);
  return { container, root, cleanup: () => rm(container, { recursive: true, force: true }) };
}

const version = await run(process.cwd(), ["jj", "version"]).catch(() => ({ code: 1, out: "", err: "" }));
const parsed = version.out.match(/\b(\d+)\.(\d+)\.\d+/);
const jjTest = version.code === 0 && !!parsed && (Number(parsed[1]) > 0 || Number(parsed[2]) >= 46) ? test : test.skip;

async function jjFixture(): Promise<Fixture & { workspace: string }> {
  const container = await realpath(await mkdtemp(join(tmpdir(), "atdd-bun-ledger-jj-"))), repo = join(container, "repository"), worktrees = join(container, "wt"), remote = join(container, "origin.git");
  await must(container, ["git", "init", "-q", "-b", "main", repo]); await must(container, ["git", "init", "-q", "--bare", remote]);
  for (const args of [["config", "user.email", "ledger@test"], ["config", "user.name", "Ledger"], ["remote", "add", "origin", remote]]) await git(repo, ...args);
  await writeFile(join(repo, "readme.md"), "init\n");
  await writeFile(join(repo, "atdd-bun.yaml"), `${policyText}protected_branches: [main, master, release]\nworktrees:\n  enabled: true\n  root: ${worktrees}\n  primary_directory: .\n  primary_branch: main\n  require_linked_worktree: true\n`);
  await git(repo, "add", "."); await git(repo, "commit", "-qm", "init");
  await jj(repo, "git", "init", "--colocate");
  expect((await startWorktree(repo, "delivery/demo", "jj")).ok).toBeTrue();
  const workspace = join(worktrees, "delivery-demo");
  await writeInventory(workspace); await authorize(workspace); await stageInventory(workspace);
  return { container, root: workspace, workspace, cleanup: () => rm(container, { recursive: true, force: true }) };
}

const obstruct = async (file: string) => { await mkdir(file, { recursive: true }); return () => rm(file, { recursive: true, force: true }); };
const bookmarkCommits = async (cwd: string, name: string) => (await jj(cwd, "--ignore-working-copy", "log", "--no-graph", "-r", `bookmarks(exact:${JSON.stringify(name)})`, "-T", 'commit_id ++ "\\n"')).split("\n").filter(Boolean);

test("git hooks: the authorized commit publishes consumed state and then removes pending", async () => {
  const f = await gitFixture(); try {
    expect((await run(f.root, ["git", "commit", "-qm", "atomic delivery"])).code).toBe(0);
    const head = await git(f.root, "rev-parse", "HEAD");
    expect(await consumedRecord(f.root)).toMatchObject({ owner_authorization: OWNER_AUTHORIZATION, commit: head, inventory_sha256: inventoryHash(inventory) });
    expect(await exists(pendingFile(f.root))).toBeFalse();
  } finally { await f.cleanup(); }
}, 120_000);

test("git hooks: a ledger publication failure preserves pending, reports a diagnostic, and a retry consumes exactly once", async () => {
  const f = await gitFixture(); try {
    expect(await runHook("pre-commit", f.root)).toMatchObject({ ok: true });
    const release = await obstruct(await consumedFile(f.root));
    expect((await run(f.root, ["git", "commit", "-qm", "atomic delivery", "--no-verify"])).code).toBe(0);
    expect(await exists(pendingFile(f.root))).toBeTrue();
    expect(await exists(consumedFile(f.root))).toBeTrue();
    const failed = await runHook("post-commit", f.root);
    expect(failed.message).toMatch(PRESERVED);
    expect(await exists(pendingFile(f.root))).toBeTrue();
    await release();
    expect((await run(f.root, [join(f.root, ".githooks", "post-commit")])).code).toBe(0);
    expect(await consumedRecord(f.root)).toMatchObject({ commit: await git(f.root, "rev-parse", "HEAD") });
    expect(await exists(pendingFile(f.root))).toBeFalse();
  } finally { await f.cleanup(); }
}, 120_000);

test("git hooks: a changed HEAD that lacks the exact inventory preserves pending, then the exact delivery consumes it", async () => {
  const f = await gitFixture(); try {
    expect(await runHook("pre-commit", f.root)).toMatchObject({ ok: true });
    await git(f.root, "reset", "-q", "--", "src/composition.ts");
    expect((await run(f.root, ["git", "commit", "-qm", "partial", "--no-verify"])).code).toBe(0);
    expect(await exists(consumedFile(f.root))).toBeFalse();
    expect(await exists(pendingFile(f.root))).toBeTrue();
    expect((await runHook("post-commit", f.root)).message).toMatch(PRESERVED);
    await git(f.root, "reset", "-q", "--soft", "HEAD~1"); await git(f.root, "add", "--", ...inventory);
    expect((await run(f.root, ["git", "commit", "-qm", "atomic delivery"])).code).toBe(0);
    expect(await consumedRecord(f.root)).toMatchObject({ commit: await git(f.root, "rev-parse", "HEAD") });
    expect(await exists(pendingFile(f.root))).toBeFalse();
  } finally { await f.cleanup(); }
}, 120_000);

test("git hooks: an interruption after consumed publication but before pending removal is finished by a retry without rewriting the ledger", async () => {
  const f = await gitFixture(); try {
    expect((await run(f.root, ["git", "commit", "-qm", "atomic delivery"])).code).toBe(0);
    const before = await readFile(await consumedFile(f.root), "utf8");
    await writeFile(await pendingFile(f.root), JSON.stringify({ owner_authorization: OWNER_AUTHORIZATION, inventory_sha256: inventoryHash(inventory) }));
    expect((await runHook("post-commit", f.root)).ok).toBeTrue();
    expect(await readFile(await consumedFile(f.root), "utf8")).toBe(before);
    expect(await exists(pendingFile(f.root))).toBeFalse();
  } finally { await f.cleanup(); }
}, 120_000);

test("git hooks: a malformed pending record is preserved with a diagnostic and never consumes", async () => {
  const f = await gitFixture(); try {
    expect(await runHook("pre-commit", f.root)).toMatchObject({ ok: true });
    const garbage = "{ not: [valid"; await writeFile(await pendingFile(f.root), garbage);
    expect((await run(f.root, ["git", "commit", "-qm", "atomic delivery", "--no-verify"])).code).toBe(0);
    expect(await readFile(await pendingFile(f.root), "utf8")).toBe(garbage);
    expect(await exists(consumedFile(f.root))).toBeFalse();
    expect((await runHook("post-commit", f.root)).message).toMatch(PRESERVED);
  } finally { await f.cleanup(); }
}, 120_000);

jjTest("jj colocated: the lifecycle consumes once, advances the delivery bookmark, and removes pending only after consumed state", async () => {
  const f = await jjFixture(); try {
    expect(await runHook("pre-commit", f.root)).toMatchObject({ ok: true });
    await git(f.root, "commit", "-q", "-m", "atomic delivery", "--no-verify");
    const head = await git(f.root, "rev-parse", "HEAD");
    expect((await runHook("post-commit", f.root)).ok).toBeTrue();
    expect(await consumedRecord(f.root)).toMatchObject({ owner_authorization: OWNER_AUTHORIZATION, commit: head });
    expect(await exists(pendingFile(f.root))).toBeFalse();
    expect(await bookmarkCommits(f.root, "delivery/demo")).toEqual([head]);
  } finally { await f.cleanup(); }
}, 120_000);

jjTest("jj colocated: a ledger publication failure preserves pending, still advances only the delivery bookmark, and a retry consumes", async () => {
  const f = await jjFixture(); try {
    expect(await runHook("pre-commit", f.root)).toMatchObject({ ok: true });
    const release = await obstruct(await consumedFile(f.root));
    await git(f.root, "commit", "-q", "-m", "atomic delivery", "--no-verify");
    const head = await git(f.root, "rev-parse", "HEAD"), mainBefore = await bookmarkCommits(f.root, "main");
    const failed = await runHook("post-commit", f.root);
    expect(failed.message).toMatch(PRESERVED);
    expect(await exists(pendingFile(f.root))).toBeTrue();
    expect(await bookmarkCommits(f.root, "main")).toEqual(mainBefore);
    await release();
    expect((await runHook("post-commit", f.root)).ok).toBeTrue();
    expect(await consumedRecord(f.root)).toMatchObject({ commit: head });
    expect(await exists(pendingFile(f.root))).toBeFalse();
  } finally { await f.cleanup(); }
}, 120_000);

jjTest("jj colocated: a changed HEAD preserves pending, and the exact delivery then consumes it", async () => {
  const f = await jjFixture(); try {
    expect(await runHook("pre-commit", f.root)).toMatchObject({ ok: true });
    await git(f.root, "reset", "-q", "--", "src/composition.ts");
    await git(f.root, "commit", "-q", "-m", "partial", "--no-verify");
    expect((await runHook("post-commit", f.root)).message).toMatch(PRESERVED);
    expect(await exists(consumedFile(f.root))).toBeFalse();
    expect(await exists(pendingFile(f.root))).toBeTrue();
    await git(f.root, "reset", "-q", "--soft", "HEAD~1"); await git(f.root, "add", "--", ...inventory);
    await git(f.root, "commit", "-q", "-m", "atomic delivery", "--no-verify");
    expect((await runHook("post-commit", f.root)).ok).toBeTrue();
    expect(await consumedRecord(f.root)).toMatchObject({ commit: await git(f.root, "rev-parse", "HEAD") });
    expect(await exists(pendingFile(f.root))).toBeFalse();
  } finally { await f.cleanup(); }
}, 120_000);

// Leftover-pending recovery negatives: a retry may complete a leftover pending ONLY when its marker and the exact HEAD
// inventory still match. Any other leftover pending fails closed with a diagnostic and blocks reuse or a new grant.
const LEFTOVER = /leftover pending authorization/;
const STALE_MARKER = () => JSON.stringify({ owner_authorization: OWNER_AUTHORIZATION, inventory_sha256: "0".repeat(64) });

test("git hooks: a leftover pending whose marker does not match the pin is preserved even when HEAD carries the exact inventory", async () => {
  const f = await gitFixture(); try {
    expect(await runHook("pre-commit", f.root)).toMatchObject({ ok: true });
    await writeFile(await pendingFile(f.root), STALE_MARKER());
    expect((await run(f.root, ["git", "commit", "-qm", "atomic delivery", "--no-verify"])).code).toBe(0);
    expect((await runHook("post-commit", f.root)).message).toMatch(PRESERVED);
    expect(await readFile(await pendingFile(f.root), "utf8")).toBe(STALE_MARKER());
    expect(await exists(consumedFile(f.root))).toBeFalse();
  } finally { await f.cleanup(); }
}, 120_000);

test("git hooks: a leftover pending beside a consumed record is not completed when HEAD is no longer the consumed delivery", async () => {
  const f = await gitFixture(); try {
    expect((await run(f.root, ["git", "commit", "-qm", "atomic delivery"])).code).toBe(0);
    const consumed = await readFile(await consumedFile(f.root), "utf8");
    const pending = JSON.stringify({ owner_authorization: OWNER_AUTHORIZATION, inventory_sha256: inventoryHash(inventory) });
    await writeFile(await pendingFile(f.root), pending);
    await writeFile(join(f.root, "unrelated.txt"), "later\n"); await git(f.root, "add", "unrelated.txt");
    expect((await run(f.root, ["git", "commit", "-qm", "unrelated", "--no-verify"])).code).toBe(0);
    const result = await runHook("post-commit", f.root);
    expect(result.message).toMatch(PRESERVED);
    expect(await readFile(await pendingFile(f.root), "utf8")).toBe(pending);
    expect(await readFile(await consumedFile(f.root), "utf8")).toBe(consumed);
  } finally { await f.cleanup(); }
}, 120_000);

test("git hooks: a leftover pending that cannot be recovered refuses a new grant with a diagnostic and keeps the ordinary rejection", async () => {
  const f = await gitFixture(); try {
    await mkdir(await ledger(f.root), { recursive: true });
    await writeFile(await pendingFile(f.root), STALE_MARKER());
    const result = await runHook("pre-commit", f.root);
    expect(result.ok).toBeFalse();
    expect(result.message).toMatch(/^staged files \d+ exceed 20/);
    expect(result.message).toContain("staged-file exception refused");
    expect(result.message).toMatch(LEFTOVER);
    expect(await readFile(await pendingFile(f.root), "utf8")).toBe(STALE_MARKER());
  } finally { await f.cleanup(); }
}, 120_000);

jjTest("jj colocated: a leftover pending beside a consumed record is preserved with a diagnostic when HEAD moved on, and no bookmark other than the delivery bookmark moves", async () => {
  const f = await jjFixture(); try {
    expect(await runHook("pre-commit", f.root)).toMatchObject({ ok: true });
    await git(f.root, "commit", "-q", "-m", "atomic delivery", "--no-verify");
    expect((await runHook("post-commit", f.root)).ok).toBeTrue();
    const consumed = await readFile(await consumedFile(f.root), "utf8"), mainBefore = await bookmarkCommits(f.root, "main");
    const pending = JSON.stringify({ owner_authorization: OWNER_AUTHORIZATION, inventory_sha256: inventoryHash(inventory) });
    await writeFile(await pendingFile(f.root), pending);
    await writeFile(join(f.root, "unrelated.txt"), "later\n"); await git(f.root, "add", "unrelated.txt");
    await git(f.root, "commit", "-q", "-m", "unrelated", "--no-verify");
    expect((await runHook("post-commit", f.root)).message).toMatch(PRESERVED);
    expect(await readFile(await pendingFile(f.root), "utf8")).toBe(pending);
    expect(await readFile(await consumedFile(f.root), "utf8")).toBe(consumed);
    expect(await bookmarkCommits(f.root, "main")).toEqual(mainBefore);
  } finally { await f.cleanup(); }
}, 120_000);
