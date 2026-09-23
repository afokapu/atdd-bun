import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finishWorktree, hookEvents, hooksStatus, installHooks, runHook, startWorktree, uninstallHooks, worktreeStatus } from "../src/hooks";

const git = async (root: string, args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); return { code: await child.exited, out: (await new Response(child.stdout).text()), err: (await new Response(child.stderr).text()) }; };
async function repo(branch = "feature") { const root = await mkdtemp(join(tmpdir(), "atdd-bun-hooks-")); for (const args of [["init", "-q", "-b", branch], ["config", "user.email", "hook@test"], ["config", "user.name", "Hook"]]) await git(root, args); await writeFile(join(root, "readme.md"), "init\n"); await git(root, ["add", "."]); await git(root, ["commit", "-qm", "init"]); return root; }
const cleanup = (root: string) => rm(root, { recursive: true, force: true });

async function worktreeLayout() {
  const container = await mkdtemp(join(tmpdir(), "atdd-bun-layout-")), main = join(container, "main");
  await mkdir(main); for (const args of [["init", "-q", "-b", "main"], ["config", "user.email", "worktree@test"], ["config", "user.name", "Worktree"]]) await git(main, args);
  await writeFile(join(main, "atdd-bun.yaml"), "worktrees:\n  enabled: true\n  root: ../worktrees\n  primary_directory: main\n  primary_branch: main\n  require_linked_worktree: true\n");
  await writeFile(join(main, "readme.md"), "init\n"); await git(main, ["add", "."]); await git(main, ["commit", "-qm", "init"]);
  return { container, main, worktrees: join(container, "worktrees") };
}

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

test("pre-commit uses the canonical planner schema gate for staged plan artifacts", async () => {
  const root = await repo(); try {
    await installHooks(root);
    await mkdir(join(root, "plan/_trains"), { recursive: true });
    await writeFile(join(root, "plan/_trains/orders.yaml"), "train_id: 1001-checkout\ntitle: Checkout journey\ndescription: A deliberately invalid train identity.\nthemes: [orders]\nparticipants: [wagon:orders]\nsequence:\n  - step: 1\n    intent: Place the order\n    from: wagon:orders\n    to: wagon:orders\n    artifact: orders:placed\n");
    await git(root, ["add", "plan/_trains/orders.yaml"]);
    const result = await runHook("pre-commit", root);
    expect(result.ok).toBeFalse();
    expect(result.message).toContain("planner.train.naming");
  } finally { await cleanup(root); }
}, 20_000);

test("declarative registries are exempt from the micro-commit size caps but still validated and removal-approved", async () => {
  const root = await repo(); try {
    const registry = (entries: number) => ["contracts:", ...Array.from({ length: entries }, (_, i) => `  - id: bad${i}\n    path: nope\n    theme: t\n    producers: []`)].join("\n") + "\n";
    await mkdir(join(root, "contracts"), { recursive: true });
    await writeFile(join(root, "contracts/_contracts.yaml"), registry(150)); await git(root, ["add", "contracts/_contracts.yaml"]);
    const large = await runHook("pre-commit", root);
    expect(large.ok).toBeFalse(); expect(large.message).not.toContain("exceed"); expect(large.message).toContain("planner.contract.registry-coherence");
    await writeFile(join(root, "atdd-bun.yaml"), "require_traceability: false\n"); await git(root, ["add", "atdd-bun.yaml"]);
    expect((await runHook("pre-commit", root)).message).toContain("planner.contract.registry-coherence");
    await writeFile(join(root, "big.ts"), Array.from({ length: 400 }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n"); await git(root, ["add", "big.ts"]);
    // 400 code lines + 1 atdd-bun.yaml line; the 601 staged registry lines are not counted.
    expect((await runHook("pre-commit", root)).message).toContain("staged changed lines 401 exceed 350");
    await git(root, ["commit", "-qm", "seed registry", "--no-verify"]);
    const message = join(root, "message"); await writeFile(message, "rewrite\n");
    await writeFile(join(root, "contracts/_contracts.yaml"), registry(150).replaceAll("path: nope", "path: nope2")); await git(root, ["add", "-A"]);
    expect((await runHook("commit-msg", root, [message])).ok).toBeTrue();
    await git(root, ["reset", "-q", "--hard"]); await rm(join(root, "contracts/_contracts.yaml")); await git(root, ["add", "-A"]);
    const removal = await runHook("commit-msg", root, [message]);
    expect(removal.ok).toBeFalse(); expect(removal.message).toContain("registry removal of 601 net lines");
    await writeFile(message, "remove registry\n[mass-delete-approved]\n"); expect((await runHook("commit-msg", root, [message])).ok).toBeTrue();
  } finally { await cleanup(root); }
}, 30_000);

test("the uncommitted-files cap counts unstaged and untracked work, never the staged commit itself", async () => {
  const root = await repo(); try {
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 100\nmax_uncommitted_files: 10\nrequire_traceability: false\n");
    for (let i = 0; i < 15; i++) await writeFile(join(root, `part-${i}.md`), "x\n");
    await git(root, ["add", "-A"]);
    expect((await runHook("pre-commit", root)).ok).toBeTrue();
    for (let i = 0; i < 11; i++) await writeFile(join(root, `untracked-${i}.md`), "x\n");
    const blocked = await runHook("pre-commit", root);
    expect(blocked.ok).toBeFalse(); expect(blocked.message).toContain("unstaged or untracked files 11 exceed 10");
    for (let i = 0; i < 11; i++) await rm(join(root, `untracked-${i}.md`));
    await git(root, ["commit", "-qm", "seed", "--no-verify"]);
    for (let i = 0; i < 11; i++) await writeFile(join(root, `part-${i}.md`), "changed\n");
    expect((await runHook("pre-commit", root)).message).toContain("unstaged or untracked files 11 exceed 10");
  } finally { await cleanup(root); }
}, 20_000);

test("pre-push fails closed on a protected destination and post-commit remains advisory without network or ATDD", async () => {
  const root = await repo(); try { await installHooks(root); const head = (await git(root, ["rev-parse", "HEAD"])).out.trim(); expect((await runHook("pre-push", root, [], `refs/heads/feature ${head} refs/heads/main 0000000000000000000000000000000000000000\n`)).ok).toBeFalse(); expect((await runHook("post-commit", root)).ok).toBeTrue(); const dispatcher = await readFile(join(root, ".githooks", "pre-commit"), "utf8"); expect(dispatcher).not.toContain("http"); expect(dispatcher).not.toContain("bunx"); expect(dispatcher).not.toContain("atdd "); }
  finally { await cleanup(root); }
}, 20_000);

test("worktree policy requires a main primary checkout and linked feature worktrees in the configured root", async () => {
  const layout = await worktreeLayout(); const feature = join(layout.worktrees, "feature-x"), outside = join(layout.container, "outside");
  try {
    await git(layout.main, ["checkout", "-qb", "feature-primary"]);
    expect((await runHook("pre-commit", layout.main)).ok).toBeFalse();
    expect((await startWorktree(layout.main, "feature/x")).ok).toBeFalse();
    await git(layout.main, ["checkout", "main"]);

    expect((await startWorktree(layout.main, "feature/x")).ok).toBeTrue();
    expect((await hooksStatus(feature)).ok).toBeTrue();
    expect((await runHook("pre-commit", feature)).ok).toBeTrue();
    expect((await worktreeStatus(feature)).message).toContain(feature);

    expect((await git(layout.main, ["worktree", "add", "-q", "-b", "outside", outside])).code).toBe(0);
    expect((await runHook("pre-commit", outside)).ok).toBeFalse();
    await git(layout.main, ["worktree", "remove", outside]);

    await writeFile(join(feature, "feature.md"), "done\n"); await git(feature, ["add", "feature.md"]); await git(feature, ["commit", "-qm", "feature", "--no-verify"]);
    expect((await finishWorktree(feature)).ok).toBeFalse();
    await git(layout.main, ["merge", "--no-ff", "feature/x", "-m", "merge feature"]);
    expect((await finishWorktree(feature, true)).ok).toBeTrue();
    expect(existsSync(feature)).toBeFalse();
  } finally { await cleanup(layout.container); }
}, 30_000);
