// URN: test:toolkit:hooks-jj-colocated-bookmark-advance:E001-UNIT-001-bound-test-file
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook, startWorktree } from "../src/hooks";

// Real Jujutsu proof for publishing a hook-validated colocated commit. `git commit` in a colocated JJ
// workspace leaves the delivery bookmark on the old empty working-copy commit, so `jj git push --bookmark`
// cannot publish the new commit. The post-commit hook must advance only the exact eligible delivery
// bookmark to the validated commit (@-); every ineligible state must leave all bookmarks untouched.
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
const git = (cwd: string, ...args: string[]) => must(cwd, ["git", ...args]);
const version = await run(process.cwd(), ["jj", "version"]).catch(() => ({ code: 1, out: "", err: "" }));
const parsed = version.out.match(/\b(\d+)\.(\d+)\.\d+/);
const jjTest = version.code === 0 && !!parsed && (Number(parsed[1]) > 0 || Number(parsed[2]) >= 46) ? test : test.skip;
const policyFile = (worktrees: string) => `protected_branches: [main, master, release]\nworktrees:\n  enabled: true\n  root: ${worktrees}\n  primary_directory: .\n  primary_branch: main\n  require_linked_worktree: true\n`;
const ADVISORY = "delivery bookmark not advanced";

// A colocated primary on main with one linked workspace on delivery/demo and a bare origin to publish to.
async function fixture() {
  const container = await realpath(await mkdtemp(join(tmpdir(), "atdd-bun-jj-bookmark-advance-")));
  const repo = join(container, "repository"), worktrees = join(container, "wt"), remote = join(container, "origin.git");
  await must(container, ["git", "init", "-q", "-b", "main", repo]);
  await must(container, ["git", "init", "-q", "--bare", remote]);
  for (const args of [["config", "user.email", "jj@test"], ["config", "user.name", "JJ"], ["remote", "add", "origin", remote]]) await git(repo, ...args);
  await writeFile(join(repo, "readme.md"), "init\n");
  await writeFile(join(repo, "atdd-bun.yaml"), policyFile(worktrees));
  await git(repo, "add", "."); await git(repo, "commit", "-qm", "init");
  await jj(repo, "git", "init", "--colocate");
  expect((await startWorktree(repo, "delivery/demo", "jj")).ok).toBeTrue();
  return { container, repo, remote, worktrees, ws: join(worktrees, "delivery-demo") };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const withFixture = (body: (f: Fixture) => Promise<void>) => async () => {
  const f = await fixture(); try { await body(f); } finally { await rm(f.container, { recursive: true, force: true }); }
};

// All local bookmark targets as stable "name:commit" lines; reads operation state only, never snapshots.
const bookmarkState = async (cwd: string) => (await jj(cwd, "--ignore-working-copy", "bookmark", "list", "-T", 'name ++ if(conflict, "(conflict)", "") ++ ":" ++ normal_target.commit_id() ++ "\\n"')).split("\n").sort().join("\n");
const bookmarkCommits = async (cwd: string, name: string) => (await jj(cwd, "--ignore-working-copy", "log", "--no-graph", "-r", `bookmarks(exact:${JSON.stringify(name)})`, "-T", 'commit_id ++ "\\n"')).split("\n").filter(Boolean);
const head = (cwd: string) => git(cwd, "rev-parse", "HEAD");

// Create a Git commit exactly as a developer does: hook-validated pre-commit, then `git commit`.
// No Jujutsu command runs between the commit and post-commit, matching the installed hook sequence.
async function commitFile(cwd: string, name: string, message = `add ${name}`) {
  await writeFile(join(cwd, name), `${name}\n`);
  await git(cwd, "add", name);
  expect(await runHook("pre-commit", cwd)).toMatchObject({ ok: true });
  await git(cwd, "commit", "-q", "-m", message);
  return head(cwd);
}
const rawCommit = async (cwd: string, name: string) => { await writeFile(join(cwd, name), `${name}\n`); await git(cwd, "add", name); await git(cwd, "commit", "-q", "-m", `add ${name}`); return head(cwd); };
const remoteRef = async (f: Fixture, branch: string) => (await run(f.remote, ["git", "rev-parse", "--verify", "-q", `refs/heads/${branch}`])).out;

jjTest("post-commit advances the exact delivery bookmark to the validated commit and keeps Git and JJ identity aligned", withFixture(async f => {
  const committed = await commitFile(f.ws, "one.txt");
  const mainBefore = await bookmarkCommits(f.ws, "main");
  const result = await runHook("post-commit", f.ws);
  expect(result.ok).toBeTrue();
  expect(await bookmarkCommits(f.ws, "delivery/demo")).toEqual([committed]);
  expect(await git(f.repo, "rev-parse", "refs/heads/delivery/demo")).toBe(committed);
  expect(await bookmarkCommits(f.ws, "main")).toEqual(mainBefore);
  expect(await jj(f.ws, "log", "--no-graph", "-r", "@ & empty()", "-T", "commit_id")).not.toBe("");
  expect(await jj(f.ws, "log", "--no-graph", "-r", "@-", "-T", "commit_id")).toBe(committed);
}), 60_000);

jjTest("a hook-validated colocated commit publishes through supported jj git push --bookmark after post-commit", withFixture(async f => {
  const committed = await commitFile(f.ws, "one.txt");
  expect((await runHook("post-commit", f.ws)).ok).toBeTrue();
  const push = await run(f.ws, ["jj", "git", "push", "--bookmark", "delivery/demo"]);
  expect(push.code).toBe(0);
  expect(await remoteRef(f, "delivery/demo")).toBe(committed);
}), 60_000);

jjTest("without the post-commit advance the same colocated commit is not published by jj git push --bookmark", withFixture(async f => {
  const committed = await commitFile(f.ws, "one.txt");
  await run(f.ws, ["jj", "git", "push", "--bookmark", "delivery/demo"]);
  expect(await remoteRef(f, "delivery/demo")).not.toBe(committed);
}), 60_000);

// Pre-commit still requires the delivery bookmark at @ (unchanged policy), so the next commit starts by
// placing the bookmark at the empty working copy again; the advance then repeats for the new commit.
jjTest("a second validated commit in the same workspace advances the bookmark again", withFixture(async f => {
  await commitFile(f.ws, "one.txt");
  expect((await runHook("post-commit", f.ws)).ok).toBeTrue();
  await jj(f.ws, "bookmark", "set", "delivery/demo", "-r", "@", "--allow-backwards");
  const second = await commitFile(f.ws, "two.txt");
  expect((await runHook("post-commit", f.ws)).ok).toBeTrue();
  expect(await bookmarkCommits(f.ws, "delivery/demo")).toEqual([second]);
  expect(await jj(f.ws, "log", "--no-graph", "-r", "@-", "-T", "commit_id")).toBe(second);
}), 60_000);

// Each ineligible state leaves every bookmark untouched, never vetoes the already-made commit, and says why.
type Negative = { name: string; arrange?: (f: Fixture) => Promise<void>; between?: (f: Fixture) => Promise<void> };
const negatives: Negative[] = [
  { name: "two non-protected bookmarks at the working copy", arrange: f => jj(f.ws, "bookmark", "create", "delivery/other", "-r", "@").then(() => undefined) },
  { name: "a protected bookmark beside the delivery bookmark", arrange: f => jj(f.ws, "bookmark", "create", "release", "-r", "@").then(() => undefined) },
  { name: "only a protected bookmark at the working copy", arrange: async f => { await jj(f.ws, "bookmark", "delete", "delivery/demo"); await jj(f.ws, "bookmark", "create", "release", "-r", "@"); } },
  { name: "no bookmark at the working copy", arrange: f => jj(f.ws, "bookmark", "delete", "delivery/demo").then(() => undefined) },
  { name: "a delivery bookmark naming an unrelated commit and none at the working copy", arrange: async f => { await jj(f.ws, "bookmark", "delete", "delivery/demo"); await jj(f.ws, "new", "main", "-m", "unrelated"); await jj(f.ws, "bookmark", "create", "delivery/unrelated", "-r", "@"); await jj(f.ws, "new", "main"); } },
  {
    name: "a conflicted delivery bookmark",
    between: async f => {
      await jj(f.ws, "status");
      const op = await jj(f.ws, "op", "log", "--no-graph", "-n1", "-T", "id.short(12)");
      await jj(f.ws, "bookmark", "set", "delivery/demo", "-r", "@-", "--allow-backwards");
      await jj(f.ws, `--at-op=${op}`, "bookmark", "set", "delivery/demo", "-r", "main", "--allow-backwards");
      expect(await jj(f.ws, "bookmark", "list", "delivery/demo")).toContain("conflicted");
    },
  },
  { name: "a dirty non-empty working copy after the commit", between: f => writeFile(join(f.ws, "dirty.txt"), "dirty\n") },
];
for (const item of negatives) {
  jjTest(`post-commit leaves every bookmark untouched and advises for ${item.name}`, withFixture(async f => {
    await item.arrange?.(f);
    await rawCommit(f.ws, "one.txt");
    await item.between?.(f);
    const before = await bookmarkState(f.ws);
    const result = await runHook("post-commit", f.ws);
    expect(result.ok).toBeTrue();
    expect(result.message).toContain(ADVISORY);
    expect(await bookmarkState(f.ws)).toBe(before);
  }), 60_000);
}

jjTest("post-commit leaves the bookmark untouched and advises when the committed HEAD is a merge commit", withFixture(async f => {
  await rawCommit(f.ws, "one.txt");
  const merge = await git(f.ws, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-p", "main", "-m", "merge");
  await git(f.ws, "update-ref", "--no-deref", "HEAD", merge);
  const before = await bookmarkState(f.ws);
  const result = await runHook("post-commit", f.ws);
  expect(result.ok).toBeTrue();
  expect(result.message).toContain(ADVISORY);
  expect(await bookmarkState(f.ws)).toBe(before);
}), 60_000);

jjTest("post-commit never moves a bookmark in the colocated primary checkout", withFixture(async f => {
  await jj(f.repo, "bookmark", "create", "delivery/primary", "-r", "@");
  await rawCommit(f.repo, "one.txt");
  const before = await bookmarkState(f.repo);
  const result = await runHook("post-commit", f.repo);
  expect(result.ok).toBeTrue();
  expect(result.message).not.toContain(ADVISORY);
  expect(await bookmarkState(f.repo)).toBe(before);
}), 60_000);

jjTest("post-commit never moves a bookmark in a workspace outside the required worktree root", withFixture(async f => {
  const outside = join(f.container, "elsewhere");
  await jj(f.repo, "workspace", "add", "--colocate", "--name", "elsewhere", "-r", "main", outside);
  await jj(outside, "bookmark", "create", "delivery/outside", "-r", "@");
  await rawCommit(outside, "one.txt");
  const before = await bookmarkState(outside);
  const result = await runHook("post-commit", outside);
  expect(result.ok).toBeTrue();
  expect(result.message).not.toContain(ADVISORY);
  expect(await bookmarkState(outside)).toBe(before);
}), 60_000);

test("post-commit in a non-JJ detached linked worktree changes no branch and does not advise", async () => {
  const container = await realpath(await mkdtemp(join(tmpdir(), "atdd-bun-git-detached-advance-")));
  try {
    const repo = join(container, "repository"), worktrees = join(container, "wt"), linked = join(worktrees, "detached");
    await must(container, ["git", "init", "-q", "-b", "main", repo]);
    for (const args of [["config", "user.email", "git@test"], ["config", "user.name", "Git"]]) await git(repo, ...args);
    await writeFile(join(repo, "atdd-bun.yaml"), policyFile(worktrees));
    await git(repo, "add", "."); await git(repo, "commit", "-qm", "init");
    await mkdir(worktrees, { recursive: true });
    await git(repo, "worktree", "add", "-q", "--detach", linked);
    await git(repo, "branch", "delivery/same-commit");
    const branchBefore = await git(repo, "rev-parse", "refs/heads/delivery/same-commit");
    await rawCommit(linked, "one.txt");
    const result = await runHook("post-commit", linked);
    expect(result.ok).toBeTrue();
    expect(result.message).not.toContain(ADVISORY);
    expect(await git(repo, "rev-parse", "refs/heads/delivery/same-commit")).toBe(branchBefore);
  } finally { await rm(container, { recursive: true, force: true }); }
}, 60_000);
