import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { enabledProfiles, enforce, profileNames } from "../src/enforce";
import { runHook } from "../src/hooks";
import { loosenedPolicy } from "../src/integrity";

// The operator decides what atdd-bun enforces: every profile by default, or the list in atdd-bun.yaml.
const repo = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), "atdd-profiles-"));
  for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
  return root;
};
const git = async (root: string, ...args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); await child.exited; };
// One traceability defect (an acceptance no test binds) and one coder defect (a source file with no header).
const TRACE = { "plan/orders/E001.yaml": "urn: wmbt:orders:E001\nacceptances:\n  - identity:\n      urn: acc:orders:E001-UNIT-001\n" };
const CODER = { "src/wagons/orders/features/a/domain/thing.ts": "export const thing = 1;\n" };
const rules = async (root: string, profiles?: Parameters<typeof enforce>[0]["profiles"]) => [...new Set((await enforce({ root, profiles })).map(v => v.rule_id.split(".")[0]))].sort();

test("by default every profile is activated", async () => {
  const root = await repo({ ...TRACE, ...CODER });
  expect(await enabledProfiles(root)).toEqual(profileNames.filter(p => p !== "all") as never);
  expect(await rules(root)).toEqual(expect.arrayContaining(["coder", "traceability"]));
}, 30_000);

test("all runs only the profiles the operator lists; a named profile still runs on request", async () => {
  const root = await repo({ ...TRACE, ...CODER, "atdd-bun.yaml": "profiles: [traceability]\n" });
  expect(await enabledProfiles(root)).toEqual(["traceability"]);
  expect(await rules(root, ["all"])).toEqual(["traceability"]);
  expect(await rules(root)).toEqual(["traceability"]);
  expect(await rules(root, ["coder"])).toContain("coder");
});

test("an unknown profile name or an empty list is an error, never a silent run of nothing", async () => {
  for (const config of ["profiles: [traceabilty]\n", "profiles: []\n", "profiles: traceability\n"]) {
    const root = await repo({ ...TRACE, "atdd-bun.yaml": config });
    await expect(enforce({ root }), config).rejects.toThrow("atdd-bun.yaml profiles");
    await expect(enforce({ root, profiles: ["coder"] }), `${config} (explicit profile)`).rejects.toThrow("atdd-bun.yaml profiles");
  }
  const root = await repo({ ...TRACE, "atdd-bun.yaml": "profiles: [nope]\n" });
  const child = Bun.spawn({ cmd: [process.execPath, resolve(import.meta.dir, "../src/cli.ts"), "all"], cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(await child.exited).not.toBe(0);
});

test("deactivating an explicitly adopted profile is reported as loosening atdd-bun.yaml; activating one is not", () => {
  expect(loosenedPolicy({ profiles: ["traceability", "planner"] }, { profiles: ["traceability"] })).toEqual(["profiles drops planner"]);
  expect(loosenedPolicy({ profiles: ["traceability"] }, { profiles: ["traceability", "coder"] })).toEqual([]);
  // The brownfield adoption cases (absent → explicit, explicit → absent) are in brownfield-adoption.test.ts.
});

test("hooks enforce only the activated profiles", async () => {
  const root = await repo({ ...CODER, "atdd-bun.yaml": "profiles: [traceability]\n" });
  await git(root, "init", "-q", "-b", "work");
  await git(root, "add", "-A");
  expect(await runHook("pre-commit", root)).toMatchObject({ ok: true });
  await writeFile(join(root, "atdd-bun.yaml"), "profiles: [coder]\n"); await git(root, "add", "-A");
  expect((await runHook("pre-commit", root)).ok).toBeFalse();
});
