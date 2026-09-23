import { expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { enforce, implementationsFor, runImplementation } from "../src/enforce";
import { loadPlan } from "../src/planner-kernel";
// @ts-expect-error: plain ESM helper shared by the detectors
import { isExcludedPath } from "../lib/scan.mjs";

// Agent worktrees nested in the repository (`.claude/worktrees/<name>`) are other checkouts of it. They must
// neither add findings to the host tree nor satisfy its obligations, and a scan run from inside one must
// still judge that worktree's own files.
const detectors = resolve(import.meta.dir, "../detectors");
const excludes = ["node_modules", ".git", ".atdd"];
const repo = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), "atdd-nested-"));
  for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
  return root;
};
const nest = async (root: string, detector: string, fixture: string) => cp(join(detectors, detector, "fixtures", fixture), join(root, ".claude/worktrees", `${detector}-${fixture}`), { recursive: true });

test("every detector ignores nested worktree copies of every dirty fixture", async () => {
  const root = await repo({});
  for (const detector of implementationsFor(["all"])) for (const fixture of await readdir(join(detectors, detector, "fixtures"))) if (fixture.startsWith("dirty")) await nest(root, detector, fixture);
  expect(await enforce({ root, profiles: ["all"] })).toEqual([]);
}, 60_000);

test("a nested worktree cannot satisfy the host's obligations", async () => {
  const root = await repo({
    "plan/orders/E001.yaml": "urn: wmbt:orders:E001\nacceptances:\n  - identity:\n      urn: acc:orders:E001-UNIT-001\n",
    ".claude/worktrees/wt/test/one.test.ts": "// URN: test:orders:x:E001-UNIT-001\n// Acceptance: acc:orders:E001-UNIT-001\n",
  });
  expect((await enforce({ root, profiles: ["traceability"] })).map(v => v.rule_id)).toEqual(["traceability.plan.executable-acceptance-has-test"]);
});

test("with plan_root `.`, nested worktree plans are not loaded as the host's plan", async () => {
  const root = await repo({ "atdd-bun.yaml": "topology:\n  plan_root: .\n" });
  for (const fixture of ["planner_schema_validation", "planner_plan_integrity", "atdd_traceability_closure"]) await nest(root, fixture, "dirty");
  expect(await enforce({ root, profiles: ["planner", "traceability"] })).toEqual([]);
  expect((await loadPlan(root)).artifacts).toEqual([]);
  // ...while the host's own plan at the root is still judged, with or without a `./` spelling.
  for (const planRoot of [".", "./"]) {
    const host = await repo({ "atdd-bun.yaml": `topology:\n  plan_root: ${planRoot}\n`, "E001.yaml": "urn: wmbt:orders:E001\nacceptances:\n  - identity:\n      urn: acc:orders:E001-UNIT-001\n" });
    expect((await enforce({ root: host, profiles: ["traceability"] })).map(v => v.rule_id), planRoot).toEqual(["traceability.plan.executable-acceptance-has-test"]);
  }
});

test("a plan root configured inside a nested worktree is not the host's plan either", async () => {
  for (const planRoot of [".claude/worktrees", ".claude/worktrees/wt/plan"]) {
    const root = await repo({ "atdd-bun.yaml": `topology:\n  plan_root: ${planRoot}\n`, ".claude/worktrees/wt/plan/orders/E001.yaml": "urn: wmbt:orders:E001\n" });
    expect((await loadPlan(root)).artifacts, planRoot).toEqual([]);
  }
});

test("a scan run from inside a nested worktree still judges that worktree", async () => {
  const host = await repo({}), inside = join(host, ".claude/worktrees/atdd_traceability_closure-dirty");
  await nest(host, "atdd_traceability_closure", "dirty");
  const own = (await runImplementation("atdd_traceability_closure", { scanRoots: [join(detectors, "atdd_traceability_closure/fixtures/dirty")], excludes })).map(v => v.rule_id).sort();
  const nested = (await runImplementation("atdd_traceability_closure", { scanRoots: [inside], excludes })).map(v => v.rule_id).sort();
  expect(own.length).toBeGreaterThan(0);
  expect(nested).toEqual(own);
});

test("path excludes match whole segments, never substrings", () => {
  expect(isExcludedPath("/r/.claude/worktrees/wt/src/a.ts", ["/r/.claude/worktrees"])).toBeTrue();
  expect(isExcludedPath("/r/node_modules/x/a.ts", ["node_modules"])).toBeTrue();
  expect(isExcludedPath("/r/src/builder.ts", ["build"])).toBeFalse();
  expect(isExcludedPath("/r/.claude/worktrees-notes/a.ts", ["/r/.claude/worktrees"])).toBeFalse();
});
