// URN: test:toolkit:hooks-jj-colocated-commit:E001-UNIT-001-bound-test-file
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook, startWorktree } from "../src/hooks";

// Real Jujutsu proof for the linked-worktree commit policy. A colocated JJ workspace keeps Git HEAD
// detached at @-, so `git symbolic-ref` is empty even when the delivery bookmark equals JJ @. The
// policy accepts that state only for exactly one non-protected bookmark at @; everything else stays refused.
const run = async (cwd: string, cmd: string[]) => {
  const child = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out: out.trim(), err: err.trim() };
};
const must = async (cwd: string, cmd: string[]) => {
  const result = await run(cwd, cmd);
  if (result.code) throw new Error(`${cmd.join(" ")} failed in ${cwd}: ${result.err || result.out}`);
  return result.out;
};
const jj = (cwd: string, ...args: string[]) => must(cwd, ["jj", ...args]);
const version = await run(process.cwd(), ["jj", "version"]).catch(() => ({ code: 1, out: "", err: "" }));
const parsed = version.out.match(/\b(\d+)\.(\d+)\.\d+/);
const jjTest = version.code === 0 && !!parsed && (Number(parsed[1]) > 0 || Number(parsed[2]) >= 46) ? test : test.skip;
const policyFile = (worktrees: string) => `protected_branches: [main, master, release]\nworktrees:\n  enabled: true\n  root: ${worktrees}\n  primary_directory: .\n  primary_branch: main\n  require_linked_worktree: true\n`;

// A colocated primary on main with the policy committed and one linked workspace started on delivery/demo.
async function fixture() {
  const container = await realpath(await mkdtemp(join(tmpdir(), "atdd-bun-jj-colocated-commit-")));
  const repo = join(container, "repository"), worktrees = join(container, "wt");
  await must(container, ["git", "init", "-q", "-b", "main", repo]);
  for (const args of [["config", "user.email", "jj@test"], ["config", "user.name", "JJ"]]) await must(repo, ["git", ...args]);
  await writeFile(join(repo, "readme.md"), "init\n");
  await writeFile(join(repo, "atdd-bun.yaml"), policyFile(worktrees));
  await must(repo, ["git", "add", "."]); await must(repo, ["git", "commit", "-qm", "init"]);
  await jj(repo, "git", "init", "--colocate");
  expect((await startWorktree(repo, "delivery/demo", "jj")).ok).toBeTrue();
  return { container, repo, worktrees, ws: join(worktrees, "delivery-demo") };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const withFixture = (body: (f: Fixture) => Promise<void>) => async () => {
  const f = await fixture(); try { await body(f); } finally { await rm(f.container, { recursive: true, force: true }); }
};
const refusedForBranch = async (cwd: string) => {
  for (const event of ["pre-commit", "pre-merge-commit"] as const) {
    const hook = await runHook(event, cwd);
    expect(hook.ok).toBeFalse(); expect(hook.message).toContain("commits require a named branch");
  }
};

jjTest("a colocated JJ workspace whose single delivery bookmark equals @ is accepted although Git HEAD is detached", withFixture(async f => {
  expect((await run(f.ws, ["git", "symbolic-ref", "--quiet", "HEAD"])).code).not.toBe(0);
  expect(await jj(f.ws, "log", "--no-graph", "-r", 'bookmarks(exact:"delivery/demo") & @', "-T", "commit_id")).not.toBe("");
  expect(await runHook("pre-commit", f.ws)).toMatchObject({ ok: true });
  expect(await runHook("pre-merge-commit", f.ws)).toMatchObject({ ok: true });
}), 60_000);

jjTest("a colocated JJ workspace with no bookmark at @ stays refused", withFixture(async f => {
  await jj(f.ws, "bookmark", "delete", "delivery/demo");
  await refusedForBranch(f.ws);
}), 60_000);

jjTest("a colocated JJ workspace whose bookmark is behind @ stays refused", withFixture(async f => {
  await jj(f.ws, "new");
  expect(await jj(f.ws, "log", "--no-graph", "-r", 'bookmarks(exact:"delivery/demo") & @', "-T", "commit_id")).toBe("");
  await refusedForBranch(f.ws);
}), 60_000);

jjTest("a colocated JJ workspace with two non-protected bookmarks at @ stays refused", withFixture(async f => {
  await jj(f.ws, "bookmark", "create", "delivery/other", "-r", "@");
  await refusedForBranch(f.ws);
}), 60_000);

jjTest("a colocated JJ workspace whose only bookmark at @ is protected stays refused", withFixture(async f => {
  await jj(f.ws, "bookmark", "delete", "delivery/demo");
  await jj(f.ws, "bookmark", "create", "release", "-r", "@");
  await refusedForBranch(f.ws);
}), 60_000);

jjTest("a colocated JJ workspace with a protected bookmark beside the delivery bookmark stays refused", withFixture(async f => {
  await jj(f.ws, "bookmark", "create", "release", "-r", "@");
  await refusedForBranch(f.ws);
}), 60_000);

jjTest("a colocated JJ workspace whose bookmark names an unrelated unmerged commit stays refused", withFixture(async f => {
  await jj(f.ws, "bookmark", "delete", "delivery/demo");
  await jj(f.ws, "new", "main", "-m", "unrelated work");
  await jj(f.ws, "bookmark", "create", "delivery/unmerged", "-r", "@");
  await jj(f.ws, "new", "main");
  expect(await jj(f.ws, "log", "--no-graph", "-r", 'bookmarks() & @', "-T", "commit_id")).toBe("");
  await refusedForBranch(f.ws);
}), 60_000);

jjTest("a colocated JJ workspace outside the required worktree root stays refused despite a matching bookmark", withFixture(async f => {
  const outside = join(f.container, "elsewhere");
  await jj(f.repo, "workspace", "add", "--colocate", "--name", "elsewhere", "-r", "main", outside);
  await jj(outside, "bookmark", "create", "delivery/outside", "-r", "@");
  const hook = await runHook("pre-commit", outside);
  expect(hook.ok).toBeFalse(); expect(hook.message).toContain("outside required root");
}), 60_000);

jjTest("the colocated JJ primary checkout stays refused despite a bookmark at @", withFixture(async f => {
  await jj(f.repo, "bookmark", "create", "delivery/primary", "-r", "@");
  const hook = await runHook("pre-commit", f.repo);
  expect(hook.ok).toBeFalse(); expect(hook.message).toContain("protected branch main is blocked");
}), 60_000);

test("a non-JJ detached linked worktree stays refused even when a branch names its commit", async () => {
  const container = await realpath(await mkdtemp(join(tmpdir(), "atdd-bun-git-detached-")));
  try {
    const repo = join(container, "repository"), worktrees = join(container, "wt"), linked = join(worktrees, "detached");
    await must(container, ["git", "init", "-q", "-b", "main", repo]);
    for (const args of [["config", "user.email", "git@test"], ["config", "user.name", "Git"]]) await must(repo, ["git", ...args]);
    await writeFile(join(repo, "atdd-bun.yaml"), policyFile(worktrees));
    await must(repo, ["git", "add", "."]); await must(repo, ["git", "commit", "-qm", "init"]);
    await mkdir(worktrees, { recursive: true });
    await must(repo, ["git", "worktree", "add", "-q", "--detach", linked]);
    await must(repo, ["git", "branch", "delivery/same-commit"]);
    await refusedForBranch(linked);
  } finally { await rm(container, { recursive: true, force: true }); }
}, 60_000);
