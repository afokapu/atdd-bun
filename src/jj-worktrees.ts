import { existsSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

export type JjWorktreePolicy = {
  enabled: boolean;
  root: string;
  primary_directory: string;
  primary_branch: string;
  require_linked_worktree: boolean;
};

export type JjPolicy = {
  protected_branches: string[];
  worktrees: JjWorktreePolicy;
};

const bad = (message: string) => ({ ok: false, message });
const command = async (cwd: string, cmd: string[]) => {
  const child = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, out: out.trim(), err: err.trim() };
};
const git = (cwd: string, args: string[]) => command(cwd, ["git", ...args]);
const jj = (cwd: string, args: string[]) => command(cwd, ["jj", ...args]);
const inside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith("../") && !path.startsWith("..\\"));
};
const branchPath = (branch: string) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

async function requireJj46(cwd: string) {
  const result = await jj(cwd, ["version"]);
  if (result.code) return `Jujutsu is unavailable: ${result.err || result.out}`;
  const match = result.out.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  if (!match) return `could not parse Jujutsu version: ${result.out}`;
  const major = Number(match[1]), minor = Number(match[2]);
  if (major === 0 && minor < 46) return `Jujutsu 0.46.0 or newer is required; found ${match[0]}`;
  return null;
}

async function primaryRoot(root: string) {
  const common = await git(root, ["rev-parse", "--git-common-dir"]);
  if (common.code || !common.out) return null;
  return realpath(dirname(resolve(root, common.out))).catch(() => null);
}

async function currentCommit(root: string) {
  await jj(root, ["status"]);
  const result = await jj(root, ["log", "-r", "@", "--no-graph", "-T", "commit_id"]);
  return result.code ? null : result.out;
}

async function branchCommit(root: string, branch: string) {
  const result = await git(root, ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);
  return result.code ? null : result.out;
}

async function branchForCommit(root: string, commit: string, protectedBranches: string[]) {
  const refs = await git(root, ["for-each-ref", "--format=%(refname:short)", "--points-at", commit, "refs/heads/"]);
  if (refs.code) return "";
  const names = refs.out.split("\n").map(line => line.trim()).filter(Boolean);
  return names.find(name => !protectedBranches.includes(name)) ?? names[0] ?? "";
}

type Layout = { primary: string; worktreeRoot: string; current: string; branch: string };
async function layout(root: string, cfg: JjPolicy): Promise<Layout | { error: string }> {
  const current = await realpath(resolve(root));
  const primary = await primaryRoot(current);
  if (!primary) return { error: "not inside a colocated Git-backed Jujutsu workspace" };
  const expectedPrimary = cfg.worktrees.primary_directory === "." ? primary : join(dirname(primary), cfg.worktrees.primary_directory);
  if (primary !== expectedPrimary) return { error: `primary checkout must be ${expectedPrimary}, not ${primary}` };
  const primaryTip = await branchCommit(primary, cfg.worktrees.primary_branch);
  if (!primaryTip) return { error: `primary bookmark ${cfg.worktrees.primary_branch} is not exported to Git` };
  const currentId = await currentCommit(current);
  const branch = currentId ? await branchForCommit(current, currentId, cfg.protected_branches) : "";
  return { primary, worktreeRoot: resolve(primary, cfg.worktrees.root.replaceAll("{repo}", basename(primary))), current, branch };
}

async function noConflicts(root: string) {
  const result = await jj(root, ["log", "-r", "@ & conflicts()", "--no-graph", "-T", "commit_id"]);
  return result.code ? { error: result.err || result.out } : result.out ? { error: "workspace has unresolved conflicts" } : {};
}

export async function startJjWorktree(root: string, branch: string, cfg: JjPolicy) {
  if (!cfg.worktrees.enabled) return bad("worktree policy is disabled; set worktrees.enabled: true in atdd-bun.yaml");
  const version = await requireJj46(root);
  if (version) return bad(version);
  const state = await layout(root, cfg);
  if ("error" in state) return bad(state.error);
  if (state.current !== state.primary) return bad(`start must run from the primary checkout ${state.primary}`);
  if (!branch) return bad("branch is required: atdd-bun worktree start <branch>");
  if ((await git(root, ["check-ref-format", "--branch", branch])).code) return bad(`invalid branch name ${JSON.stringify(branch)}`);
  if (cfg.protected_branches.includes(branch)) return bad(`cannot create a worktree for protected branch ${branch}`);
  if (await branchCommit(state.primary, branch)) return bad(`branch ${branch} already exists`);
  const leaf = branchPath(branch);
  if (!leaf) return bad(`branch ${JSON.stringify(branch)} cannot form a safe worktree directory`);
  const target = join(state.worktreeRoot, leaf);
  if (existsSync(target)) return bad(`worktree path already exists: ${target}`);
  await mkdir(state.worktreeRoot, { recursive: true });

  const created = await jj(state.primary, ["workspace", "add", "--colocate", "--name", leaf, "-r", cfg.worktrees.primary_branch, target]);
  if (created.code) return bad(created.err || created.out);
  const bookmark = await jj(target, ["bookmark", "set", branch, "-r", "@"]);
  const id = await currentCommit(target);
  const exported = await branchCommit(target, branch);
  if (bookmark.code || !id || exported !== id) {
    await jj(state.primary, ["workspace", "remove", leaf]);
    await jj(state.primary, ["bookmark", "delete", branch]);
    return bad(bookmark.err || bookmark.out || `bookmark ${branch} was not exported to the colocated Git repository`);
  }
  return { ok: true, message: `created linked Jujutsu workspace ${target} on ${branch}` };
}

export async function statusJjWorktrees(root: string, cfg: JjPolicy) {
  if (!cfg.worktrees.enabled) return bad("worktree policy is disabled");
  const version = await requireJj46(root);
  if (version) return bad(version);
  const state = await layout(root, cfg);
  if ("error" in state) return bad(state.error);
  const result = await jj(state.primary, ["workspace", "list"]);
  return result.code ? bad(result.err || result.out) : { ok: true, message: result.out };
}

export async function finishJjWorktree(root: string, deleteBranch: boolean, cfg: JjPolicy) {
  if (!cfg.worktrees.enabled) return bad("worktree policy is disabled");
  const version = await requireJj46(root);
  if (version) return bad(version);
  const state = await layout(root, cfg);
  if ("error" in state) return bad(state.error);
  if (state.current === state.primary || !inside(state.worktreeRoot, state.current)) return bad(`finish must run from a linked workspace beneath ${state.worktreeRoot}`);

  const conflict = await noConflicts(state.current);
  if ("error" in conflict) return bad(conflict.error);
  const id = await currentCommit(state.current);
  if (!id) return bad("could not resolve the current Jujutsu revision");
  const branch = await branchForCommit(state.current, id, cfg.protected_branches);
  if (!branch || cfg.protected_branches.includes(branch)) return bad("finish requires a non-protected bookmark exported as a Git branch");
  const tip = await branchCommit(state.primary, branch);
  if (!tip || tip !== id) return bad(`bookmark ${branch} must point at the current Jujutsu revision before finish`);
  if ((await git(state.primary, ["merge-base", "--is-ancestor", tip, cfg.worktrees.primary_branch])).code) {
    return bad(`branch ${branch} is not merged into ${cfg.worktrees.primary_branch} in the primary checkout`);
  }

  const name = branchPath(branch);
  const recorded = await jj(state.primary, ["workspace", "root", "--name", name]);
  if (recorded.code) return bad(`workspace ${name} is not registered: ${recorded.err || recorded.out}`);
  const recordedPath = await realpath(recorded.out).catch(() => null);
  if (recordedPath !== state.current) return bad(`workspace ${name} resolves to ${recorded.out}, not ${state.current}`);

  const removed = await jj(state.primary, ["workspace", "remove", name]);
  if (removed.code) return bad(removed.err || removed.out);
  if (deleteBranch) {
    const now = await branchCommit(state.primary, branch);
    if (now !== tip || (await git(state.primary, ["merge-base", "--is-ancestor", tip, cfg.worktrees.primary_branch])).code) {
      return bad(`workspace removed, but bookmark ${branch} was not deleted: its tip changed or is no longer merged into ${cfg.worktrees.primary_branch}`);
    }
    const deleted = await jj(state.primary, ["bookmark", "delete", branch]);
    if (deleted.code) return bad(`workspace removed, but bookmark deletion failed: ${deleted.err || deleted.out}`);
  }
  return { ok: true, message: `removed merged Jujutsu workspace ${state.current}${deleteBranch ? ` and bookmark ${branch}` : ""}` };
}
