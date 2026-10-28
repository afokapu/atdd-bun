import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finishWorktree, startWorktree } from "../src/hooks";

// Real Jujutsu proof for `worktree finish --vcs jj`. These tests drive the exported
// lifecycle against a temporary colocated repository using the jj on PATH.
const run = async (cwd: string, cmd: string[]) => {
  const child = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out: out.trim(), err: err.trim() };
};
const jj = async (cwd: string, ...args: string[]) => {
  const result = await run(cwd, ["jj", ...args]);
  if (result.code) throw new Error(`jj ${args.join(" ")} failed in ${cwd}: ${result.err || result.out}`);
  return result.out;
};
const version = await run(process.cwd(), ["jj", "version"]).catch(() => ({ code: 1, out: "", err: "" }));
const parsed = version.out.match(/\b(\d+)\.(\d+)\.\d+/);
const jjUsable = version.code === 0 && !!parsed && (Number(parsed[1]) > 0 || Number(parsed[2]) >= 46);
const jjTest = jjUsable ? test : test.skip;

async function fixture() {
  // realpath: macOS reports /private/var for temp dirs, and finish compares real paths.
  const container = await realpath(await mkdtemp(join(tmpdir(), "atdd-bun-jj-finish-")));
  const repo = join(container, "repository"), worktrees = join(container, "wt");
  await run(container, ["git", "init", "-q", "-b", "main", repo]);
  for (const args of [["config", "user.email", "jj@test"], ["config", "user.name", "JJ"]]) await run(repo, ["git", ...args]);
  await writeFile(join(repo, "readme.md"), "init\n");
  await writeFile(join(repo, "atdd-bun.yaml"), `worktrees:\n  enabled: true\n  root: ${worktrees}\n  primary_directory: .\n  primary_branch: main\n  require_linked_worktree: true\n`);
  await run(repo, ["git", "add", "."]); await run(repo, ["git", "commit", "-qm", "init"]);
  await jj(repo, "git", "init", "--colocate");
  const started = await startWorktree(repo, "delivery/demo", "jj");
  expect(started.ok).toBeTrue();
  const ws = join(worktrees, "delivery-demo");
  const bookmark = async (name: string) => (await run(repo, ["git", "rev-parse", "--verify", "--quiet", `refs/heads/${name}`])).code === 0;
  return { container, repo, ws, bookmark };
}
const outcome = (result: { ok: boolean; message: string }) => ({ ok: result.ok, message: result.message });

// Delivers content: the workspace change is merged by moving main onto it.
async function deliverContent(ws: string) {
  await writeFile(join(ws, "feature.txt"), "feature\n");
  await jj(ws, "status");
  await jj(ws, "bookmark", "set", "main", "-r", "@");
}

jjTest("finish accepts an empty bookmark tip directly above main and deletes its bookmark", async () => {
  const f = await fixture(); try {
    expect(outcome(await finishWorktree(f.ws, true, "jj"))).toMatchObject({ ok: true });
    expect(existsSync(f.ws)).toBeFalse();
    expect(await f.bookmark("delivery/demo")).toBeFalse();
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

jjTest("finish accepts an empty tip reached through several empty changes above main", async () => {
  const f = await fixture(); try {
    await jj(f.ws, "new"); await jj(f.ws, "new");
    await jj(f.ws, "bookmark", "set", "delivery/demo", "-r", "@");
    expect(outcome(await finishWorktree(f.ws, true, "jj"))).toMatchObject({ ok: true });
    expect(existsSync(f.ws)).toBeFalse();
    expect(await f.bookmark("delivery/demo")).toBeFalse();
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

jjTest("finish accepts an empty tip above merged content", async () => {
  const f = await fixture(); try {
    await deliverContent(f.ws);
    await jj(f.ws, "new");
    await jj(f.ws, "bookmark", "set", "delivery/demo", "-r", "@");
    expect(outcome(await finishWorktree(f.ws, true, "jj"))).toMatchObject({ ok: true });
    expect(existsSync(f.ws)).toBeFalse();
    expect(await f.bookmark("delivery/demo")).toBeFalse();
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

jjTest("finish resolves the workspace by path after the delivery bookmark was renamed", async () => {
  const f = await fixture(); try {
    await deliverContent(f.ws);
    await jj(f.ws, "bookmark", "rename", "delivery/demo", "delivery/renamed");
    expect(outcome(await finishWorktree(f.ws, true, "jj"))).toMatchObject({ ok: true });
    expect(existsSync(f.ws)).toBeFalse();
    expect(await f.bookmark("delivery/renamed")).toBeFalse();
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

jjTest("finish handles a renamed bookmark on an empty tip", async () => {
  const f = await fixture(); try {
    await jj(f.ws, "bookmark", "rename", "delivery/demo", "delivery/renamed");
    expect(outcome(await finishWorktree(f.ws, true, "jj"))).toMatchObject({ ok: true });
    expect(existsSync(f.ws)).toBeFalse();
    expect(await f.bookmark("delivery/renamed")).toBeFalse();
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

// Negatives: every refusal must leave the workspace and bookmark untouched.
async function expectRefused(f: Awaited<ReturnType<typeof fixture>>, message: string, name = "delivery/demo") {
  const result = await finishWorktree(f.ws, true, "jj");
  expect(outcome(result)).toMatchObject({ ok: false });
  expect(result.message).toContain(message);
  expect(existsSync(f.ws)).toBeTrue();
  expect(await f.bookmark(name)).toBeTrue();
}

jjTest("finish refuses a tip with unmerged content", async () => {
  const f = await fixture(); try {
    await writeFile(join(f.ws, "feature.txt"), "feature\n"); await jj(f.ws, "status");
    await expectRefused(f, "not merged");
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

jjTest("finish refuses an empty tip whose nearest non-empty ancestor is unmerged", async () => {
  const f = await fixture(); try {
    await writeFile(join(f.ws, "feature.txt"), "feature\n"); await jj(f.ws, "status");
    await jj(f.ws, "new");
    await jj(f.ws, "bookmark", "set", "delivery/demo", "-r", "@");
    await expectRefused(f, "not merged");
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

jjTest("finish refuses an empty tip with ambiguous bookmarks", async () => {
  const f = await fixture(); try {
    await jj(f.ws, "bookmark", "set", "delivery/alias", "-r", "@");
    await expectRefused(f, "exactly one non-protected exported bookmark");
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

// A merge of two changes editing the same line produces a conflicted commit that main then adopts.
async function conflictedMerged(ws: string) {
  await jj(ws, "new", "main", "-m", "left"); await writeFile(join(ws, "readme.md"), "left\n"); await jj(ws, "status");
  await jj(ws, "new", "main", "-m", "right"); await writeFile(join(ws, "readme.md"), "right\n"); await jj(ws, "status");
  await jj(ws, "new", "description(exact:'left\n')", "description(exact:'right\n')", "-m", "merge");
  expect(await jj(ws, "log", "-r", "@ & conflicts()", "--no-graph", "-T", "commit_id")).not.toBe("");
  await jj(ws, "bookmark", "set", "delivery/demo", "-r", "@", "--allow-backwards");
  await jj(ws, "bookmark", "set", "main", "-r", "@");
}

jjTest("finish refuses a merged tip that has unresolved conflicts", async () => {
  const f = await fixture(); try {
    await conflictedMerged(f.ws);
    await expectRefused(f, "conflicts");
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

jjTest("finish refuses an empty tip above a conflicted merged change", async () => {
  const f = await fixture(); try {
    await conflictedMerged(f.ws);
    await jj(f.ws, "new");
    await jj(f.ws, "bookmark", "set", "delivery/demo", "-r", "@");
    await expectRefused(f, "conflicts");
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

jjTest("finish fails closed when the workspace was moved so the registry path no longer matches", async () => {
  const f = await fixture(); try {
    const moved = join(f.container, "wt", "moved");
    await rename(f.ws, moved);
    const result = await finishWorktree(moved, true, "jj");
    expect(outcome(result)).toMatchObject({ ok: false });
    expect(existsSync(moved)).toBeTrue();
    expect(await f.bookmark("delivery/demo")).toBeTrue();
    expect((await jj(f.repo, "workspace", "list")).includes("delivery-demo")).toBeTrue();
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);

jjTest("finish fails closed when the workspace was forgotten from the registry", async () => {
  const f = await fixture(); try {
    await jj(f.repo, "workspace", "forget", "delivery-demo");
    const result = await finishWorktree(f.ws, true, "jj");
    expect(outcome(result)).toMatchObject({ ok: false });
    expect(existsSync(f.ws)).toBeTrue();
    expect(await f.bookmark("delivery/demo")).toBeTrue();
  } finally { await rm(f.container, { recursive: true, force: true }); }
}, 60_000);
