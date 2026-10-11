import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { policy, runHook } from "../src/hooks";
import { activationContextDigest, contextDigest } from "../src/ratchet";

// The source repo's own atdd-bun.yaml is the system under test: its worktrees key must enable the linked-worktree
// policy for the real layout (primary ~/Github/<repo> on main, seats beneath ~/Github/.worktrees/<repo>).
const repoRoot = resolve(import.meta.dir, "..");
const frozenContext = "372404875390a2ec884398af38fde20792029bfb6412885dd5f7b37028a0daaf";
const git = async (root: string, args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); return { code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() }; };

test("the source repo enables the linked-worktree policy with the .worktrees/{repo} layout and primary main", async () => {
  const { worktrees } = await policy(repoRoot);
  expect(worktrees).toEqual({ enabled: true, root: "../.worktrees/{repo}", primary_directory: ".", primary_branch: "main", require_linked_worktree: true });
});

test("the configured layout accepts a seat worktree and rejects commits from the primary checkout and outside the root", async () => {
  const container = await mkdtemp(join(tmpdir(), "atdd-bun-enable-worktrees-")), primary = join(container, "atdd-bun"), seat = join(container, ".worktrees", "atdd-bun", "seat"), outside = join(container, "elsewhere");
  try {
    await mkdir(primary);
    for (const args of [["init", "-q", "-b", "main"], ["config", "user.email", "wt@test"], ["config", "user.name", "Wt"]]) await git(primary, args);
    // Only the real worktrees key is carried over (plus an unrelated protected branch, so main's own protection does not
    // mask the worktree decision) and the ratchet gate stays out of the way.
    const configured = (Bun.YAML.parse(await readFile(join(repoRoot, "atdd-bun.yaml"), "utf8")) as Record<string, unknown>).worktrees;
    await writeFile(join(primary, "atdd-bun.yaml"), configured === undefined ? "protected_branches: [release]\n" : Bun.YAML.stringify({ protected_branches: ["release"], worktrees: configured }));
    await writeFile(join(primary, "readme.md"), "init\n"); await git(primary, ["add", "."]); await git(primary, ["commit", "-qm", "init", "--no-verify"]);
    expect((await git(primary, ["worktree", "add", "-q", "-b", "seat", seat])).code).toBe(0);
    expect((await git(primary, ["worktree", "add", "-q", "-b", "elsewhere", outside])).code).toBe(0);
    expect((await runHook("pre-commit", seat)).ok).toBeTrue();
    const direct = await runHook("pre-commit", primary);
    expect(direct.ok).toBeFalse(); expect(direct.message).toContain("linked worktree");
    const stray = await runHook("pre-commit", outside);
    expect(stray.ok).toBeFalse(); expect(stray.message).toContain("outside required root");
  } finally { await rm(container, { recursive: true, force: true }); }
}, 30_000);

test("the worktrees key leaves the frozen all-profile ratchet context digest unchanged", async () => {
  const config = Bun.YAML.parse(await readFile(join(repoRoot, "atdd-bun.yaml"), "utf8")) as Record<string, unknown>;
  expect(contextDigest(config, config.profiles as string[])).toBe(frozenContext);
  const { worktrees: _worktrees, ...withoutWorktrees } = config;
  expect(activationContextDigest(config)).toBe(activationContextDigest(withoutWorktrees));
  expect(Object.keys(config).filter(key => key !== "worktrees").sort()).toEqual(["profiles", "ratchet"]);
});
