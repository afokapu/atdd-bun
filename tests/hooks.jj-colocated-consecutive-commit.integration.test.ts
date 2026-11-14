// URN: test:toolkit:hooks-jj-colocated-consecutive-commit:E001-UNIT-001-bound-test-file
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook, startWorktree } from "../src/hooks";

// Real Jujutsu proof for consecutive ordinary `git commit`s in a linked colocated workspace. After the first
// validated commit the post-commit hook leaves the delivery bookmark on that commit (@-) with @ an empty child, so
// the next pre-commit must admit exactly that state and the next post-commit must advance the bookmark again.
// Every other state stays refused (fail closed) and never moves a bookmark.
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
const NAMED_BRANCH = "commits require a named branch";

async function fixture() {
  const container = await realpath(await mkdtemp(join(tmpdir(), "atdd-bun-jj-consecutive-")));
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

const bookmarkState = async (cwd: string) => (await jj(cwd, "--ignore-working-copy", "bookmark", "list", "-T", 'name ++ if(conflict, "(conflict)", "") ++ ":" ++ normal_target.commit_id() ++ "\\n"')).split("\n").sort().join("\n");
const bookmarkCommits = async (cwd: string, name: string) => (await jj(cwd, "--ignore-working-copy", "log", "--no-graph", "-r", `bookmarks(exact:${JSON.stringify(name)})`, "-T", 'commit_id ++ "\\n"')).split("\n").filter(Boolean);
const head = (cwd: string) => git(cwd, "rev-parse", "HEAD");
const remoteRef = async (f: Fixture, branch: string) => (await run(f.remote, ["git", "rev-parse", "--verify", "-q", `refs/heads/${branch}`])).out;

// Ordinary developer commit: staged file, hook-validated pre-commit, `git commit`, then post-commit. No Jujutsu
// command runs between the commit and post-commit, matching the installed hook sequence.
async function stage(cwd: string, name: string) { await writeFile(join(cwd, name), `${name}\n`); await git(cwd, "add", name); }
async function commitFile(cwd: string, name: string) {
  await stage(cwd, name);
  for (const event of ["pre-commit", "pre-merge-commit"] as const) expect(await runHook(event, cwd)).toMatchObject({ ok: true });
  await git(cwd, "commit", "-q", "-m", `add ${name}`);
  const committed = await head(cwd);
  const post = await runHook("post-commit", cwd);
  expect(post.ok).toBeTrue();
  expect(post.message).not.toContain(ADVISORY);
  return committed;
}
const rawCommit = async (cwd: string, name: string) => { await stage(cwd, name); await git(cwd, "commit", "-q", "-m", `add ${name}`); return head(cwd); };
const refusedForBranch = async (cwd: string) => {
  for (const event of ["pre-commit", "pre-merge-commit"] as const) {
    const hook = await runHook(event, cwd);
    expect(hook.ok).toBeFalse(); expect(hook.message).toContain(NAMED_BRANCH);
  }
};

jjTest("three consecutive git commits each pass pre-commit and advance the bookmark to the newest validated commit", withFixture(async f => {
  const commits: string[] = [];
  for (const name of ["one.txt", "two.txt", "three.txt"]) {
    commits.push(await commitFile(f.ws, name));
    expect(await bookmarkCommits(f.ws, "delivery/demo")).toEqual([commits.at(-1)!]);
    expect(await git(f.repo, "rev-parse", "refs/heads/delivery/demo")).toBe(commits.at(-1)!);
    expect(await jj(f.ws, "log", "--no-graph", "-r", "@-", "-T", "commit_id")).toBe(commits.at(-1)!);
    expect(await jj(f.ws, "log", "--no-graph", "-r", "@ & empty()", "-T", "commit_id")).not.toBe("");
  }
  expect(new Set(commits).size).toBe(3);
  expect(await bookmarkCommits(f.ws, "main")).toEqual([await git(f.repo, "rev-parse", "main")]);
}), 90_000);

jjTest("the third consecutive commit publishes through jj git push --bookmark", withFixture(async f => {
  await commitFile(f.ws, "one.txt"); await commitFile(f.ws, "two.txt");
  const third = await commitFile(f.ws, "three.txt");
  expect((await run(f.ws, ["jj", "git", "push", "--bookmark", "delivery/demo"])).code).toBe(0);
  expect(await remoteRef(f, "delivery/demo")).toBe(third);
}), 90_000);

// Second-commit state: commit one validated and advanced; the next commit is staged but not yet validated.
// Each arrangement breaks exactly one admission condition; pre-commit must refuse and post-commit must not move anything.
type Negative = { name: string; arrange: (f: Fixture) => Promise<void> };
const negatives: Negative[] = [
  { name: "no bookmark on @-", arrange: f => jj(f.ws, "bookmark", "delete", "delivery/demo").then(() => undefined) },
  { name: "two non-protected bookmarks on @-", arrange: f => jj(f.ws, "bookmark", "create", "delivery/other", "-r", "@-").then(() => undefined) },
  { name: "a protected bookmark beside the delivery bookmark on @-", arrange: f => jj(f.ws, "bookmark", "create", "release", "-r", "@-").then(() => undefined) },
  { name: "only a protected bookmark on @-", arrange: async f => { await jj(f.ws, "bookmark", "delete", "delivery/demo"); await jj(f.ws, "bookmark", "create", "release", "-r", "@-"); } },
  { name: "the bookmark on an older commit than @-", arrange: async f => { await jj(f.ws, "bookmark", "set", "delivery/demo", "-r", "main", "--allow-backwards"); } },
  {
    name: "a conflicted delivery bookmark",
    arrange: async f => {
      await jj(f.ws, "status");
      const op = await jj(f.ws, "op", "log", "--no-graph", "-n1", "-T", "id.short(12)");
      await jj(f.ws, "bookmark", "set", "delivery/demo", "-r", "@", "--allow-backwards");
      await jj(f.ws, `--at-op=${op}`, "bookmark", "set", "delivery/demo", "-r", "main", "--allow-backwards");
      expect(await jj(f.ws, "bookmark", "list", "delivery/demo")).toContain("conflicted");
    },
  },
  { name: "Git HEAD not equal to @-", arrange: async f => { await git(f.ws, "update-ref", "--no-deref", "HEAD", await git(f.repo, "rev-parse", "main")); } },
  { name: "a non-empty working copy", arrange: async f => { await writeFile(join(f.ws, "dirty.txt"), "dirty\n"); await jj(f.ws, "status"); } },
];
for (const item of negatives) {
  jjTest(`a second commit stays refused by pre-commit for ${item.name}`, withFixture(async f => {
    await commitFile(f.ws, "one.txt");
    await item.arrange(f);
    await stage(f.ws, "two.txt");
    const before = await bookmarkState(f.ws);
    await refusedForBranch(f.ws);
    expect(await bookmarkState(f.ws)).toBe(before);
  }), 90_000);
  jjTest(`post-commit of a second commit leaves every bookmark untouched and advises for ${item.name}`, withFixture(async f => {
    await commitFile(f.ws, "one.txt");
    await item.arrange(f);
    await rawCommit(f.ws, "two.txt");
    const before = await bookmarkState(f.ws);
    const result = await runHook("post-commit", f.ws);
    expect(result.ok).toBeTrue();
    expect(result.message).toContain(ADVISORY);
    expect(await bookmarkState(f.ws)).toBe(before);
  }), 90_000);
}

jjTest("an empty bookmark-bearing @- (a plain jj new) stays refused by pre-commit and is never advanced", withFixture(async f => {
  await jj(f.ws, "new");
  await stage(f.ws, "one.txt");
  await refusedForBranch(f.ws);
  await rawCommit(f.ws, "two.txt");
  const before = await bookmarkState(f.ws);
  expect((await runHook("post-commit", f.ws)).message).toContain(ADVISORY);
  expect(await bookmarkState(f.ws)).toBe(before);
}), 90_000);

jjTest("post-commit leaves the bookmark untouched and advises when the second HEAD is a merge commit", withFixture(async f => {
  await commitFile(f.ws, "one.txt");
  await rawCommit(f.ws, "two.txt");
  const merge = await git(f.ws, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-p", "main", "-m", "merge");
  await git(f.ws, "update-ref", "--no-deref", "HEAD", merge);
  const before = await bookmarkState(f.ws);
  const result = await runHook("post-commit", f.ws);
  expect(result.ok).toBeTrue();
  expect(result.message).toContain(ADVISORY);
  expect(await bookmarkState(f.ws)).toBe(before);
}), 90_000);

jjTest("the colocated primary checkout stays refused despite a bookmark on a content @-", withFixture(async f => {
  await jj(f.repo, "bookmark", "create", "delivery/primary", "-r", "@");
  await rawCommit(f.repo, "one.txt");
  await runHook("post-commit", f.repo);
  await jj(f.repo, "bookmark", "set", "delivery/primary", "-r", "@-", "--allow-backwards");
  await stage(f.repo, "two.txt");
  const hook = await runHook("pre-commit", f.repo);
  expect(hook.ok).toBeFalse(); expect(hook.message).toMatch(/linked worktree|protected branch/);
}), 90_000);

jjTest("a workspace outside the required worktree root stays refused despite a bookmark on a content @-", withFixture(async f => {
  const outside = join(f.container, "elsewhere");
  await jj(f.repo, "workspace", "add", "--colocate", "--name", "elsewhere", "-r", "main", outside);
  await jj(outside, "bookmark", "create", "delivery/outside", "-r", "@");
  await rawCommit(outside, "one.txt");
  await jj(outside, "bookmark", "set", "delivery/outside", "-r", "@-", "--allow-backwards");
  await stage(outside, "two.txt");
  const hook = await runHook("pre-commit", outside);
  expect(hook.ok).toBeFalse(); expect(hook.message).toContain("outside required root");
}), 90_000);

test("a non-JJ detached linked worktree stays refused after a commit even when a branch names HEAD", async () => {
  const container = await realpath(await mkdtemp(join(tmpdir(), "atdd-bun-git-detached-consecutive-")));
  try {
    const repo = join(container, "repository"), worktrees = join(container, "wt"), linked = join(worktrees, "detached");
    await must(container, ["git", "init", "-q", "-b", "main", repo]);
    for (const args of [["config", "user.email", "git@test"], ["config", "user.name", "Git"]]) await git(repo, ...args);
    await writeFile(join(repo, "atdd-bun.yaml"), policyFile(worktrees));
    await git(repo, "add", "."); await git(repo, "commit", "-qm", "init");
    await git(repo, "worktree", "add", "-q", "--detach", linked);
    await rawCommit(linked, "one.txt");
    await git(repo, "branch", "delivery/same-commit", await head(linked));
    await stage(linked, "two.txt");
    await refusedForBranch(linked);
  } finally { await rm(container, { recursive: true, force: true }); }
}, 60_000);

// Pre-commit must never admit a commit that post-commit cannot advance.
const refusedWith = async (cwd: string, reason: string) => {
  for (const event of ["pre-commit", "pre-merge-commit"] as const) {
    const hook = await runHook(event, cwd);
    expect(hook.ok).toBeFalse(); expect(hook.message).toContain(NAMED_BRANCH); expect(hook.message).toContain(reason);
  }
};

jjTest("snapshot then a fully staged commit: the non-empty bookmarked @ is refused with a diagnostic, not admitted and stranded", withFixture(async f => {
  await stage(f.ws, "one.txt");
  await jj(f.ws, "status");
  expect(await jj(f.ws, "log", "--no-graph", "-r", "@ & empty()", "-T", "commit_id")).toBe("");
  const before = await bookmarkState(f.ws);
  await refusedWith(f.ws, "working-copy commit is not empty");
  expect(await bookmarkState(f.ws)).toBe(before);
}), 90_000);

jjTest("after a snapshot, `jj new` leaves a non-empty bookmarked @- and the next git commit passes and advances", withFixture(async f => {
  await stage(f.ws, "one.txt");
  await jj(f.ws, "status");
  await jj(f.ws, "new");
  const second = await commitFile(f.ws, "two.txt");
  expect(await bookmarkCommits(f.ws, "delivery/demo")).toEqual([second]);
  expect(await jj(f.ws, "log", "--no-graph", "-r", "@-", "-T", "commit_id")).toBe(second);
}), 90_000);

jjTest("a second commit is admitted and advanced when @ is empty but described", withFixture(async f => {
  await commitFile(f.ws, "one.txt");
  await jj(f.ws, "describe", "-m", "wip");
  expect(await jj(f.ws, "log", "--no-graph", "-r", "@ & empty()", "-T", "commit_id")).not.toBe("");
  const second = await commitFile(f.ws, "two.txt");
  expect(await bookmarkCommits(f.ws, "delivery/demo")).toEqual([second]);
}), 90_000);

jjTest("pre-commit refuses a first commit when Git HEAD is not @- because post-commit could not advance it", withFixture(async f => {
  await git(f.ws, "update-ref", "--no-deref", "HEAD", await git(f.ws, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "elsewhere"));
  await stage(f.ws, "one.txt");
  await refusedForBranch(f.ws);
}), 90_000);

jjTest("the refusal for an empty bookmarked @- names the empty parent commit", withFixture(async f => {
  await jj(f.ws, "new");
  await stage(f.ws, "one.txt");
  await refusedWith(f.ws, "parent commit is empty");
}), 90_000);

jjTest("snapshot then a partially staged commit: the non-empty bookmarked @ is refused and nothing moves", withFixture(async f => {
  await writeFile(join(f.ws, "staged.txt"), "staged\n"); await writeFile(join(f.ws, "unstaged.txt"), "unstaged\n");
  await jj(f.ws, "status");
  await git(f.ws, "add", "staged.txt");
  const before = await bookmarkState(f.ws);
  await refusedWith(f.ws, "working-copy commit is not empty");
  expect(await bookmarkState(f.ws)).toBe(before);
}), 90_000);
