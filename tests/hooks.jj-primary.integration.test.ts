// URN: test:toolkit:hooks-jj-primary:E001-UNIT-001-bound-test-file
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook, worktreeStatus } from "../src/hooks";

// Real Jujutsu proof for the primary-branch layout check. A JJ-colocated primary keeps Git HEAD
// detached at its working-copy parent, so the check must read JJ state: it accepts the primary only
// when that parent is exactly main or main@origin, and keeps strict Git behavior everywhere else.
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
const version = await run(process.cwd(), ["jj", "version"]).catch(() => ({ code: 1, out: "", err: "" }));
const parsed = version.out.match(/\b(\d+)\.(\d+)\.\d+/);
const jjTest = version.code === 0 && !!parsed && (Number(parsed[1]) > 0 || Number(parsed[2]) >= 46) ? test : test.skip;

// A primary on main with the worktree policy committed, an origin that carries main, and a linked Git worktree.
async function fixture(colocate: boolean) {
  const container = await realpath(await mkdtemp(join(tmpdir(), "atdd-bun-jj-primary-")));
  const repo = join(container, "repository"), origin = join(container, "origin.git"), linked = join(container, "worktrees", "repository", "feature-x");
  await run(container, ["git", "init", "-q", "--bare", "-b", "main", origin]);
  await run(container, ["git", "init", "-q", "-b", "main", repo]);
  for (const args of [["config", "user.email", "jj@test"], ["config", "user.name", "JJ"]]) await run(repo, ["git", ...args]);
  await writeFile(join(repo, "atdd-bun.yaml"), "worktrees:\n  enabled: true\n");
  await writeFile(join(repo, "readme.md"), "init\n");
  await run(repo, ["git", "add", "."]); await run(repo, ["git", "commit", "-qm", "init"]);
  await run(repo, ["git", "remote", "add", "origin", origin]); await must(repo, ["git", "push", "-q", "origin", "main"]);
  if (colocate) await must(repo, ["jj", "git", "init", "--colocate"]);
  return { container, repo, linked };
}
const jj = (repo: string, ...args: string[]) => must(repo, ["jj", ...args]);
const rejectsOffMain = async (repo: string) => {
  const hook = await runHook("pre-commit", repo), status = await worktreeStatus(repo);
  expect(hook.ok).toBeFalse(); expect(hook.message).toContain("must be on main");
  expect(status.ok).toBeFalse(); expect(status.message).toContain("must be on main");
};
// A valid primary passes the layout check: the primary itself is then refused only for committing outside a linked worktree.
const acceptsPrimary = async (f: Awaited<ReturnType<typeof fixture>>) => {
  const hook = await runHook("pre-commit", f.repo);
  expect(hook.ok).toBeFalse(); expect(hook.message).toContain("commits must use a linked worktree");
  expect((await worktreeStatus(f.repo)).ok).toBeTrue();
  await must(f.repo, ["git", "worktree", "add", "-q", "-b", "feature/x", f.linked]);
  expect(await runHook("pre-commit", f.linked)).toMatchObject({ ok: true });
};

jjTest("a JJ-colocated primary whose working-copy parent is main passes the primary-branch check", async () => {
  const f = await fixture(true); try {
    await jj(f.repo, "new", "main"); await must(f.repo, ["git", "checkout", "-q", "--detach"]); await jj(f.repo, "status");
    expect((await run(f.repo, ["git", "symbolic-ref", "--quiet", "HEAD"])).code).not.toBe(0);
    expect(await jj(f.repo, "log", "-r", "@- & main", "--no-graph", "-T", "commit_id")).not.toBe("");
    await acceptsPrimary(f);
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

jjTest("a JJ-colocated primary whose working-copy parent is main@origin passes when local main has moved", async () => {
  const f = await fixture(true); try {
    await jj(f.repo, "new", "main"); await writeFile(join(f.repo, "ahead.md"), "ahead\n");
    await jj(f.repo, "commit", "-m", "ahead"); await jj(f.repo, "bookmark", "set", "main", "-r", "@-");
    await jj(f.repo, "new", "main@origin");
    expect(await jj(f.repo, "log", "-r", "@- & main", "--no-graph", "-T", "commit_id")).toBe("");
    await acceptsPrimary(f);
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

jjTest("a JJ-colocated primary whose working-copy parent is any other commit stays rejected", async () => {
  const f = await fixture(true); try {
    await jj(f.repo, "new", "main"); await writeFile(join(f.repo, "feature.md"), "feature\n");
    await jj(f.repo, "commit", "-m", "feature");
    await rejectsOffMain(f.repo);
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

jjTest("a JJ-colocated primary whose working copy merges main with another parent stays rejected", async () => {
  const f = await fixture(true); try {
    await jj(f.repo, "new", "main"); await writeFile(join(f.repo, "feature.md"), "feature\n");
    await jj(f.repo, "commit", "-m", "feature"); await jj(f.repo, "new", "main", "@-");
    expect((await jj(f.repo, "log", "-r", "@-", "--no-graph", "-T", "commit_id ++ \"\\n\"")).split("\n")).toHaveLength(2);
    await rejectsOffMain(f.repo);
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

test("a non-JJ primary detached at main stays rejected", async () => {
  const f = await fixture(false); try {
    await must(f.repo, ["git", "checkout", "-q", "--detach", "main"]);
    await rejectsOffMain(f.repo);
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);
