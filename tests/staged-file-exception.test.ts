import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runHook } from "../src/hooks";

/**
 * RED: the owner-authorized, single-use staged-file-count exception for Score's atomic delivery.
 * Authorization: M-20261104T155526Z-owner-authorization_3fd46f1c; evidence: M-20261104T120517Z-atomic-decision-evidence_a871b6f0.
 * The pin (project, task, message ids, inventory) lives in reviewed package source; the activation record lives in the
 * consumer's Git common directory and can only confirm, never widen, that pin. Only the staged-file-count limit relaxes.
 */
const OWNER_AUTHORIZATION = "M-20261104T155526Z-owner-authorization_3fd46f1c";
const DECISION_EVIDENCE = "M-20261104T120517Z-atomic-decision-evidence_a871b6f0";
const SCHEMA = "atdd-bun.staged-file-limit-exception/v1";

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

const git = async (root: string, args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); return { code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() }; };
const inventoryHash = (paths: string[]) => new Bun.CryptoHasher("sha256").update([...paths].sort().join("\n")).digest("hex");
const validRecord = () => ({ schema: SCHEMA, project: "score-os", task: "wagon-control-implementation-v2", scope: "staged-file-count", owner_authorization: OWNER_AUTHORIZATION, decision_evidence: DECISION_EVIDENCE, inventory: [...inventory], inventory_sha256: inventoryHash(inventory) });
const ORDINARY = "staged files 42 exceed 20";

async function consumer(extra = "") {
  const root = await mkdtemp(join(tmpdir(), "atdd-bun-staged-exception-"));
  for (const args of [["init", "-q", "-b", "feature"], ["config", "user.email", "exception@test"], ["config", "user.name", "Exception"]]) await git(root, args);
  await writeFile(join(root, "atdd-bun.yaml"), `profiles: [security]\nmax_staged_files: 20\nrequire_traceability: false\n${extra}`);
  await writeFile(join(root, "readme.md"), "init\n");
  await git(root, ["add", "."]); await git(root, ["commit", "-qm", "init", "--no-verify"]);
  for (const path of inventory) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), `content of ${path}\n`); }
  return root;
}
const stage = (root: string, paths = inventory) => git(root, ["add", "--", ...paths]);
const directory = async (root: string) => join(root, (await git(root, ["rev-parse", "--git-common-dir"])).out.trim(), "atdd-bun", "staged-file-limit-exception");
const authorize = async (root: string, record: unknown = validRecord(), raw?: string) => { const dir = await directory(root); await mkdir(dir, { recursive: true }); await writeFile(join(dir, "authorization.yaml"), raw ?? JSON.stringify(record)); };
const commit = (root: string, message: string) => git(root, ["commit", "-qm", message, "--no-verify"]);
const cleanup = (root: string) => rm(root, { recursive: true, force: true });

test("without an activation record the ordinary staged-file-count rejection is unchanged", async () => {
  const root = await consumer(); try {
    await stage(root);
    expect(await runHook("pre-commit", root)).toEqual({ ok: false, message: ORDINARY });
  } finally { await cleanup(root); }
}, 30_000);

test("a valid record admits exactly the authorized inventory past the staged-file-count limit", async () => {
  const root = await consumer(); try {
    await authorize(root); await stage(root);
    expect((await git(root, ["diff", "--cached", "--name-only"])).out.trim().split("\n").sort()).toEqual([...inventory].sort());
    expect(await runHook("pre-commit", root)).toMatchObject({ ok: true });
  } finally { await cleanup(root); }
}, 30_000);

test("the exception relaxes only the file count: the changed-line cap still rejects", async () => {
  const root = await consumer(); try {
    await writeFile(join(root, "src/composition.ts"), Array.from({ length: 400 }, (_, index) => `export const line${index} = ${index};`).join("\n") + "\n");
    await authorize(root); await stage(root);
    const result = await runHook("pre-commit", root);
    expect(result.ok).toBeFalse();
    expect(result.message).toMatch(/^staged changed lines \d+ exceed 350/);
  } finally { await cleanup(root); }
}, 30_000);

test("the exception leaves the protected-branch gate in force", async () => {
  const root = await consumer("protected_branches: [feature]\n"); try {
    await authorize(root); await stage(root);
    expect(await runHook("pre-commit", root)).toEqual({ ok: false, message: "protected branch feature is blocked" });
  } finally { await cleanup(root); }
}, 30_000);

type Refusal = { name: string; reason: RegExp; record?: unknown; raw?: string; unrecorded?: true; staged?: (root: string) => Promise<unknown> };
const stagedWithout = (path: string) => (root: string) => stage(root, inventory.filter(candidate => candidate !== path));
const widened = () => { const paths = [...inventory, "src/outside.ts"]; return { ...validRecord(), inventory: paths, inventory_sha256: inventoryHash(paths) }; };
const refusals: Refusal[] = [
  { name: "missing record", unrecorded: true, reason: /authorization record is missing/ },
  { name: "malformed YAML", raw: "{ not: [valid", reason: /authorization record is malformed/ },
  { name: "non-mapping record", raw: "- just\n- a list\n", reason: /authorization record is malformed/ },
  { name: "unknown schema", record: { ...validRecord(), schema: "atdd-bun.staged-file-limit-exception/v0" }, reason: /authorization record is malformed/ },
  { name: "missing field", record: (({ decision_evidence: _evidence, ...rest }) => rest)(validRecord()), reason: /authorization record is malformed/ },
  { name: "non-string field", record: { ...validRecord(), owner_authorization: 3 }, reason: /authorization record is malformed/ },
  { name: "owner authorization id mismatch", record: { ...validRecord(), owner_authorization: "M-20261104T155526Z-owner-authorization_00000000" }, reason: /does not match the pinned authorization/ },
  { name: "decision evidence id mismatch", record: { ...validRecord(), decision_evidence: "M-20261104T120517Z-atomic-decision-evidence_00000000" }, reason: /does not match the pinned authorization/ },
  { name: "task mismatch", record: { ...validRecord(), task: "another-task" }, reason: /does not match the pinned authorization/ },
  { name: "project mismatch", record: { ...validRecord(), project: "other-project" }, reason: /does not match the pinned authorization/ },
  { name: "scope mismatch", record: { ...validRecord(), scope: "staged-changed-lines" }, reason: /does not match the pinned authorization/ },
  { name: "inventory hash mismatch", record: { ...validRecord(), inventory_sha256: "0".repeat(64) }, reason: /inventory hash does not match/ },
  { name: "record inventory widened beyond the pin", record: widened(), staged: async root => { await mkdir(join(root, "src"), { recursive: true }); await writeFile(join(root, "src/outside.ts"), "x\n"); return stage(root, [...inventory, "src/outside.ts"]); }, reason: /does not match the pinned authorization/ },
  { name: "staged path outside the inventory", staged: async root => { await writeFile(join(root, "src/outside.ts"), "x\n"); return stage(root, [...inventory, "src/outside.ts"]); }, reason: /outside the authorized inventory: src\/outside\.ts/ },
  { name: "staged path missing from the inventory", staged: stagedWithout("src/composition.ts"), reason: /missing from the staged set: src\/composition\.ts/ },
];

for (const refusal of refusals) {
  test(`fails closed on ${refusal.name} and keeps the ordinary rejection`, async () => {
    const root = await consumer(); try {
      if (!refusal.unrecorded) await authorize(root, refusal.record, refusal.raw);
      await (refusal.staged ?? (r => stage(r)))(root);
      // Two plan registries and six generated journey views are exempt from the count.
      const staged = (await git(root, ["diff", "--cached", "--name-only"])).out.trim().split("\n").length;
      const result = await runHook("pre-commit", root);
      expect(result.ok).toBeFalse();
      expect(result.message).toStartWith(`staged files ${staged - 8} exceed 20`);
      expect(result.message).toContain("staged-file exception refused");
      expect(result.message).toMatch(refusal.reason);
    } finally { await cleanup(root); }
  }, 30_000);
}

test("a same-size path set with a self-consistent record is refused because it differs from the pinned inventory", async () => {
  const root = await consumer(); try {
    const swapped = inventory.map(path => path === "src/composition.ts" ? "src/other.ts" : path);
    await writeFile(join(root, "src/other.ts"), "x\n");
    await authorize(root, { ...validRecord(), inventory: swapped, inventory_sha256: inventoryHash(swapped) });
    await stage(root, swapped);
    const result = await runHook("pre-commit", root);
    expect(result.ok).toBeFalse();
    expect(result.message).toMatch(/does not match the pinned authorization/);
  } finally { await cleanup(root); }
}, 30_000);

test("a retry before any commit is still authorized, and the authorization is consumed only by the authorized commit", async () => {
  const root = await consumer(); try {
    await authorize(root); await stage(root);
    expect(await runHook("pre-commit", root)).toMatchObject({ ok: true });
    expect(await runHook("pre-commit", root)).toMatchObject({ ok: true });
    expect(existsSync(join(await directory(root), "consumed.yaml"))).toBeFalse();
    expect((await commit(root, "atomic delivery")).code).toBe(0);
    const head = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    expect(await runHook("post-commit", root)).toMatchObject({ ok: true });
    const consumed = Bun.YAML.parse(await readFile(join(await directory(root), "consumed.yaml"), "utf8")) as Record<string, unknown>;
    expect(consumed).toMatchObject({ owner_authorization: OWNER_AUTHORIZATION, commit: head, inventory_sha256: inventoryHash(inventory) });
    expect(existsSync(join(await directory(root), "pending.yaml"))).toBeFalse();
  } finally { await cleanup(root); }
}, 30_000);

test("a second delivery of the same inventory is refused as reused after the authorized commit", async () => {
  const root = await consumer(); try {
    await authorize(root); await stage(root);
    expect(await runHook("pre-commit", root)).toMatchObject({ ok: true });
    await commit(root, "atomic delivery"); await runHook("post-commit", root);
    for (const path of inventory) await writeFile(join(root, path), `second revision of ${path}\n`);
    await stage(root);
    const result = await runHook("pre-commit", root);
    expect(result.ok).toBeFalse();
    expect(result.message).toStartWith(ORDINARY);
    expect(result.message).toContain("staged-file exception refused");
    expect(result.message).toMatch(/authorization was already consumed/);
  } finally { await cleanup(root); }
}, 30_000);

test("a commit that does not match the authorized inventory never consumes the authorization", async () => {
  const root = await consumer(); try {
    await authorize(root); await stage(root);
    expect(await runHook("pre-commit", root)).toMatchObject({ ok: true });
    await git(root, ["reset", "-q", "--", "src/composition.ts"]);
    expect((await commit(root, "partial delivery")).code).toBe(0);
    expect(await runHook("post-commit", root)).toMatchObject({ ok: true });
    expect(existsSync(join(await directory(root), "consumed.yaml"))).toBeFalse();
    expect(existsSync(join(await directory(root), "pending.yaml"))).toBeFalse();
  } finally { await cleanup(root); }
}, 30_000);
