import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { adoptionOf, gate, partition } from "../src/adoption";
import { enforce } from "../src/enforce";
import { runHook } from "../src/hooks";
import { loosenedPolicy } from "../src/integrity";

// A Decision OS-like brownfield adoption: the base commit is a legacy `billing` wagon full of debt (schema,
// closure, headers). A change then adds a compliant `orders` slice. The gate must let that slice through while
// the full audit still fails the repository, and must still block anything the change itself breaks.
const fixtures = resolve(import.meta.dir, "fixtures/brownfield");
const git = async (root: string, ...args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); if (await child.exited) throw new Error(`git ${args.join(" ")}: ${await new Response(child.stderr).text()}`); return (await new Response(child.stdout).text()).trim(); };
const BROWNFIELD = "adoption:\n  mode: brownfield\n  base: main\n";

/** A repository on branch `work`, forked from `main`, whose only commit is the legacy tree. */
async function legacyRepo(config: string | null = BROWNFIELD) {
  const root = await mkdtemp(join(tmpdir(), "atdd-adoption-"));
  await git(root, "init", "-q", "-b", "main"); await git(root, "config", "user.email", "t@t"); await git(root, "config", "user.name", "t");
  await cp(join(fixtures, "legacy"), root, { recursive: true });
  if (config !== null) await writeFile(join(root, "atdd-bun.yaml"), config);
  await git(root, "add", "-A"); await git(root, "commit", "-qm", "legacy");
  await git(root, "checkout", "-qb", "work");
  return root;
}
const addSlice = (root: string) => cp(join(fixtures, "slice"), root, { recursive: true });
const where = (root: string, files: { rule_id: string; file: string }[]) => files.map(v => `${v.rule_id} ${v.file.startsWith(root) ? v.file.slice(root.length + 1) : v.file}`).sort();
const STRAY = "// URN: component:orders:place:Stray:backend:domain\nexport const stray = 1;\n";

test("the compliant slice is clean under the full audit on its own", async () => {
  expect(await enforce({ root: join(fixtures, "slice"), profiles: ["all"] })).toEqual([]);
});

test("legacy debt does not block a compliant slice, and the full audit still fails the repository", async () => {
  const root = await legacyRepo();
  try {
    await addSlice(root);
    const result = await gate({ root, base: "main" });
    expect(where(root, result.blocking)).toEqual([]);
    expect(result.ok).toBeTrue();
    expect(result.outside).toBeGreaterThan(20);
    expect(result.message).toContain(`${result.outside} legacy finding(s) outside the slice`);
    const full = where(root, await enforce({ root, profiles: ["all"] }));
    expect(full.length).toBe(result.outside);
    expect(full).toContain("traceability.plan.executable-acceptance-has-test plan/billing/E001.yaml");
    expect(full).toContain("traceability.source.tested-by-present src/wagons/billing/features/invoice/domain/invoice.ts");
    // Committed rather than in the working tree: the same verdict.
    await git(root, "add", "-A"); await git(root, "commit", "-qm", "slice");
    expect((await gate({ root, base: "main" })).ok).toBeTrue();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("a non-compliant file in the slice blocks", async () => {
  const root = await legacyRepo();
  try {
    await addSlice(root); await writeFile(join(root, "src/wagons/orders/features/place/domain/stray.ts"), STRAY);
    const blocking = where(root, (await gate({ root, base: "main" })).blocking);
    expect(blocking).toContain("traceability.source.tested-by-present src/wagons/orders/features/place/domain/stray.ts");
    expect(blocking.every(line => line.endsWith("stray.ts"))).toBeTrue();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("deleting a legacy test brings the acceptance it bound into the slice, and only that one", async () => {
  const root = await legacyRepo();
  try {
    await git(root, "rm", "-q", "tests/wagons/billing/features/invoice/unit/number.test.ts");
    const blocking = where(root, (await gate({ root, base: "main" })).blocking);
    expect(blocking).toContain("traceability.plan.executable-acceptance-has-test plan/billing/E001.yaml");
    const result = await gate({ root, base: "main" });
    expect(result.blocking.map(v => v.evidence).filter(e => e.includes("has no Bun test binding"))).toEqual(["acc:billing:E001-UNIT-002-numbers-invoice has no Bun test binding"]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("touching a legacy file makes that file's debt blocking", async () => {
  const root = await legacyRepo();
  try {
    const file = join(root, "src/wagons/billing/features/invoice/domain/invoice.ts");
    await writeFile(file, (await readFile(file, "utf8")) + "export const currency = \"EUR\";\n");
    const blocking = where(root, (await gate({ root, base: "main" })).blocking);
    expect(blocking).toContain("traceability.source.tested-by-present src/wagons/billing/features/invoice/domain/invoice.ts");
    expect(blocking).toContain("coder.bun.green-header-tested-by src/wagons/billing/features/invoice/domain/invoice.ts");
    expect(blocking.some(line => line.includes("plan/billing/E001.yaml") && line.startsWith("atdd-bun.planner.schema"))).toBeFalse();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("greenfield (the default) gates on the full audit, and an unresolvable base never narrows the scope", async () => {
  for (const [config, base] of [[null, "main"], [BROWNFIELD, "no-such-ref"]] as const) {
    const root = await legacyRepo(config);
    try {
      await addSlice(root);
      const result = await gate({ root, base });
      expect(result.ok).toBeFalse();
      expect(result.outside).toBe(0);
      expect(result.blocking.length).toBe((await enforce({ root, profiles: ["all"] })).length);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
}, 60_000);

test("an unknown or malformed adoption mode is read as greenfield, which blocks everything", () => {
  for (const config of [{ adoption: { mode: "yolo" } }, { adoption: "brownfield" }, { adoption: null }, {}]) expect(adoptionOf(config).mode).toBe("greenfield");
  const finding = { rule_id: "x", file: "legacy.ts", line: 1, col: 1, evidence: "", source_line: "" };
  expect(partition("/r", "greenfield", [finding], { files: new Set(), identities: new Set() }).blocking).toEqual([finding]);
});

test("deleting a feature's only source brings that feature's own obligations into the slice", async () => {
  const root = await legacyRepo();
  try {
    await git(root, "rm", "-q", "src/wagons/billing/features/invoice/domain/invoice.ts");
    const blocking = where(root, (await gate({ root, base: "main" })).blocking);
    expect(blocking).toContain("atdd-bun.topology.feature-source-coverage plan/billing/invoice.yaml");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("pre-commit gates the staged slice in brownfield: compliant passes, a broken file blocks", async () => {
  const root = await legacyRepo();
  try {
    await addSlice(root); await git(root, "add", "-A");
    expect(await runHook("pre-commit", root)).toMatchObject({ ok: true });
    await writeFile(join(root, "src/wagons/orders/features/place/domain/stray.ts"), STRAY); await git(root, "add", "-A");
    const blocked = await runHook("pre-commit", root);
    expect(blocked.ok).toBeFalse();
    expect(blocked.message).toContain("stray.ts");
    expect(blocked.message).not.toContain("billing");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("pre-push gates the pushed commits in brownfield: compliant passes, a broken file blocks", async () => {
  const root = await legacyRepo();
  try {
    const push = async () => runHook("pre-push", root, [], `refs/heads/work ${await git(root, "rev-parse", "HEAD")} refs/heads/work ${"0".repeat(40)}\n`);
    await addSlice(root); await git(root, "add", "-A"); await git(root, "commit", "-qm", "slice");
    expect(await push()).toMatchObject({ ok: true });
    await writeFile(join(root, "src/wagons/orders/features/place/domain/stray.ts"), STRAY); await git(root, "add", "-A"); await git(root, "commit", "-qm", "stray");
    const blocked = await push();
    expect(blocked.ok).toBeFalse();
    expect(blocked.message).toContain("stray.ts");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);

test("greenfield hooks still block on legacy debt", async () => {
  const root = await legacyRepo(null);
  try {
    await addSlice(root); await git(root, "add", "-A");
    expect((await runHook("pre-commit", root)).ok).toBeFalse();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("switching to brownfield loosens the policy; staying brownfield does not", () => {
  expect(loosenedPolicy({}, { adoption: { mode: "brownfield" } })).toEqual(["adoption.mode greenfield → brownfield"]);
  expect(loosenedPolicy({ adoption: { mode: "brownfield" } }, { adoption: { mode: "brownfield" } })).toEqual([]);
  expect(loosenedPolicy({ adoption: { mode: "brownfield" } }, {})).toEqual([]);
});

test("the CLI gate exits non-zero on blocking findings and zero on a compliant slice", async () => {
  const root = await legacyRepo();
  try {
    await addSlice(root);
    const run = async () => { const child = Bun.spawn({ cmd: [process.execPath, resolve(import.meta.dir, "../src/cli.ts"), "gate", "--base", "main"], cwd: root, stdout: "pipe", stderr: "pipe" }); return { code: await child.exited, out: await new Response(child.stdout).text() + await new Response(child.stderr).text() }; };
    const clean = await run();
    expect(clean.code).toBe(0);
    expect(clean.out).toContain("brownfield: changed slice");
    await writeFile(join(root, "src/wagons/orders/features/place/domain/stray.ts"), STRAY);
    expect((await run()).code).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
