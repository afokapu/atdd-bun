import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookEvents, hooksStatus, installHooks, runHook, uninstallHooks } from "../src/hooks";

const git = async (root: string, args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); return { code: await child.exited, out: (await new Response(child.stdout).text()), err: (await new Response(child.stderr).text()) }; };
async function repo(branch = "feature") { const root = await mkdtemp(join(tmpdir(), "atdd-bun-hooks-")); for (const args of [["init", "-q", "-b", branch], ["config", "user.email", "hook@test"], ["config", "user.name", "Hook"]]) await git(root, args); await writeFile(join(root, "readme.md"), "init\n"); await git(root, ["add", "."]); await git(root, ["commit", "-qm", "init"]); return root; }
const cleanup = (root: string) => rm(root, { recursive: true, force: true });

test("real Git installation is idempotent, worktree-local, and removable", async () => {
  const root = await repo(); try { expect((await installHooks(root)).ok).toBeTrue(); expect((await installHooks(root)).ok).toBeTrue(); expect((await hooksStatus(root)).ok).toBeTrue(); expect((await git(root, ["config", "--worktree", "--get", "core.hooksPath"])).out.trim()).toBe(".githooks"); for (const event of hookEvents) expect((await readFile(join(root, ".githooks", event), "utf8")).includes("atdd ")).toBeFalse(); const wt = `${root}-wt`; expect((await git(root, ["worktree", "add", "-q", "-b", "linked", wt])).code).toBe(0); expect((await installHooks(wt)).ok).toBeTrue(); expect((await git(wt, ["config", "--worktree", "--get", "core.hooksPath"])).out.trim()).toBe(".githooks"); expect((await uninstallHooks(root)).ok).toBeTrue(); expect((await hooksStatus(root)).ok).toBeFalse(); }
  finally { await cleanup(root); await cleanup(`${root}-wt`); }
}, 20_000);

test("real Git policy rejects protected branches, each micro threshold, deletion without token, and bad traceability", async () => {
  const root = await repo("main"); try {
    await installHooks(root); await writeFile(join(root, "x.ts"), "export const x = 1;\n"); await git(root, ["add", "x.ts"]); expect((await git(root, ["commit", "-m", "blocked"])).code).not.toBe(0);
    await git(root, ["checkout", "-qb", "feature"]); await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 0\nmax_staged_changed_lines: 0\nmax_uncommitted_files: 0\n"); await git(root, ["add", "atdd-bun.yaml"]); expect((await runHook("pre-commit", root)).ok).toBeFalse();
    await writeFile(join(root, "plan.yml"), "x\n"); await git(root, ["add", "plan.yml"]); const trace = await runHook("pre-commit", root); expect(trace.ok).toBeFalse();
    for (let i = 0; i < 51; i++) await writeFile(join(root, `delete-${i}.txt`), "x\n"); await git(root, ["add", "."]); await git(root, ["commit", "-qm", "seed deletes", "--no-verify"]); for (let i = 0; i < 51; i++) await rm(join(root, `delete-${i}.txt`)); await git(root, ["add", "-A"]); const message = join(root, "message"); await writeFile(message, "delete\n"); expect((await runHook("commit-msg", root, [message])).ok).toBeFalse(); await writeFile(message, "delete\n[mass-delete-approved]\n"); expect((await runHook("commit-msg", root, [message])).ok).toBeTrue();
  } finally { await cleanup(root); }
}, 30_000);

test("pre-push fails closed on a protected destination and post-commit remains advisory without network or ATDD", async () => {
  const root = await repo(); try { await installHooks(root); const head = (await git(root, ["rev-parse", "HEAD"])).out.trim(); expect((await runHook("pre-push", root, [], `refs/heads/feature ${head} refs/heads/main 0000000000000000000000000000000000000000\n`)).ok).toBeFalse(); expect((await runHook("post-commit", root)).ok).toBeTrue(); const dispatcher = await readFile(join(root, ".githooks", "pre-commit"), "utf8"); expect(dispatcher).not.toContain("http"); expect(dispatcher).not.toContain("bunx"); expect(dispatcher).not.toContain("atdd "); }
  finally { await cleanup(root); }
}, 20_000);
