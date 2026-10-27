// URN: component:atdd-bun:jj-worktrees:jj-worktrees:backend:application
// Tested-By:
// - test:atdd-bun:jj-worktrees:E001-UNIT-001
// Runtime: bun
// Purpose: Manage colocated Jujutsu workspaces without changing the Git lifecycle.
//
// Jujutsu mode is a sidecar to the established Git worktree policy. The repository
// must be colocated, so Git object IDs remain the lineage currency while JJ owns
// working-copy commits, workspace creation, and bookmark movement.
//
// JJ 0.46 is the minimum because it introduced colocated additional workspaces.
// Bookmarks are expected to export to Git branches; those refs preserve existing
// merge ancestry, protected-branch policy, and publication behavior.
//
// Retirement is fail-closed: the current revision must identify one delivery
// bookmark, that bookmark must still point at the revision, and the commit must
// already be merged into the protected primary branch before removal.
//
// VCS-specific mechanics stay here so Git hooks, detectors, and policy remain
// untouched and the public worktree API only dispatches by explicit VCS mode.
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

// A delivery commit must have one unambiguous non-protected exported bookmark.
// Ref ordering is never used as ownership authority.
async function branchForCommit(root: string, commit: string, protectedBranches: string[]) {
  const refs = await git(root, ["for-each-ref", "--format=%(refname:short)", "--points-at", commit, "refs/heads/"]);
  if (refs.code) return { error: refs.err || refs.out };
  const candidates = refs.out.split("\n").map(line => line.trim()).filter(Boolean)
    .filter(name => !protectedBranches.includes(name));
  return candidates.length === 1
    ? { branch: candidates[0]! }
    : { error: `current Jujutsu revision must have exactly one non-protected exported bookmark; found ${candidates.length}` };
}

type Layout = { primary: string; worktreeRoot: string; current: string };
async function layout(root: string, cfg: JjPolicy): Promise<Layout | { error: string }> {
  const current = await realpath(resolve(root));
  const primary = await primaryRoot(current);
  if (!primary) return { error: "not inside a colocated Git-backed Jujutsu workspace" };
  const expectedPrimary = cfg.worktrees.primary_directory === "." ? primary : join(dirname(primary), cfg.worktrees.primary_directory);
  if (primary !== expectedPrimary) return { error: `primary checkout must be ${expectedPrimary}, not ${primary}` };
  const primaryTip = await branchCommit(primary, cfg.worktrees.primary_branch);
  if (!primaryTip) return { error: `primary bookmark ${cfg.worktrees.primary_branch} is not exported to Git` };
  return { primary, worktreeRoot: resolve(primary, cfg.worktrees.root.replaceAll("{repo}", basename(primary))), current };
}

async function noConflicts(root: string) {
  const result = await jj(root, ["log", "-r", "@ & conflicts()", "--no-graph", "-T", "commit_id"]);
  return result.code ? { error: result.err || result.out } : result.out ? { error: "workspace has unresolved conflicts" } : {};
}

async function preflight(root: string, cfg: JjPolicy): Promise<Layout | { error: string }> {
  if (!cfg.worktrees.enabled) return { error: "worktree policy is disabled; set worktrees.enabled: true in atdd-bun.yaml" };
  const version = await requireJj46(root);
  return version ? { error: version } : layout(root, cfg);
}

async function startTarget(root: string, branch: string, state: Layout, cfg: JjPolicy) {
  if (state.current !== state.primary) return { error: `start must run from the primary checkout ${state.primary}` };
  if (!branch) return { error: "branch is required: atdd-bun worktree start <branch>" };
  if ((await git(root, ["check-ref-format", "--branch", branch])).code) return { error: `invalid branch name ${JSON.stringify(branch)}` };
  if (cfg.protected_branches.includes(branch)) return { error: `cannot create a worktree for protected branch ${branch}` };
  if (await branchCommit(state.primary, branch)) return { error: `branch ${branch} already exists` };
  const leaf = branchPath(branch);
  if (!leaf) return { error: `branch ${JSON.stringify(branch)} cannot form a safe worktree directory` };
  const target = join(state.worktreeRoot, leaf);
  return existsSync(target) ? { error: `worktree path already exists: ${target}` } : { leaf, target };
}

// Workspace creation is two-phase. If bookmark export fails, both JJ artifacts
// are rolled back so a failed start leaves no reusable partial delivery state.
async function createWorkspace(state: Layout, target: { leaf: string; target: string }, branch: string, cfg: JjPolicy) {
  await mkdir(state.worktreeRoot, { recursive: true });
  const created = await jj(state.primary, ["workspace", "add", "--colocate", "--name", target.leaf, "-r", cfg.worktrees.primary_branch, target.target]);
  if (created.code) return bad(created.err || created.out);
  const bookmark = await jj(target.target, ["bookmark", "set", branch, "-r", "@"]);
  const id = await currentCommit(target.target);
  const exported = await branchCommit(target.target, branch);
  if (!bookmark.code && id && exported === id) return { ok: true, message: `created linked Jujutsu workspace ${target.target} on ${branch}` };
  await jj(state.primary, ["workspace", "remove", target.leaf]);
  await jj(state.primary, ["bookmark", "delete", branch]);
  return bad(bookmark.err || bookmark.out || `bookmark ${branch} was not exported to the colocated Git repository`);
}

async function finishCandidate(state: Layout, cfg: JjPolicy) {
  if (state.current === state.primary || !inside(state.worktreeRoot, state.current)) return { error: `finish must run from a linked workspace beneath ${state.worktreeRoot}` };
  const conflict = await noConflicts(state.current);
  if ("error" in conflict) return conflict;
  const id = await currentCommit(state.current);
  if (!id) return { error: "could not resolve the current Jujutsu revision" };
  const found = await branchForCommit(state.current, id, cfg.protected_branches);
  if ("error" in found) return found;
  const tip = await branchCommit(state.primary, found.branch);
  if (!tip || tip !== id) return { error: `bookmark ${found.branch} must point at the current Jujutsu revision before finish` };
  if ((await git(state.primary, ["merge-base", "--is-ancestor", tip, cfg.worktrees.primary_branch])).code) return { error: `branch ${found.branch} is not merged into ${cfg.worktrees.primary_branch} in the primary checkout` };
  return { branch: found.branch, tip, name: branchPath(found.branch) };
}

// The sanitized bookmark name is not sufficient authority to remove a workspace;
// verify the JJ registry resolves that name back to the exact current path.
async function verifyWorkspace(state: Layout, candidate: { name: string }) {
  const recorded = await jj(state.primary, ["workspace", "root", "--name", candidate.name]);
  if (recorded.code) return `workspace ${candidate.name} is not registered: ${recorded.err || recorded.out}`;
  const recordedPath = await realpath(recorded.out).catch(() => null);
  return recordedPath === state.current ? null : `workspace ${candidate.name} resolves to ${recorded.out}, not ${state.current}`;
}

async function deleteBookmark(state: Layout, candidate: { branch: string; tip: string }, cfg: JjPolicy) {
  const now = await branchCommit(state.primary, candidate.branch);
  const merged = !(await git(state.primary, ["merge-base", "--is-ancestor", candidate.tip, cfg.worktrees.primary_branch])).code;
  if (now !== candidate.tip || !merged) return `workspace removed, but bookmark ${candidate.branch} was not deleted: its tip changed or is no longer merged into ${cfg.worktrees.primary_branch}`;
  const deleted = await jj(state.primary, ["bookmark", "delete", candidate.branch]);
  return deleted.code ? `workspace removed, but bookmark deletion failed: ${deleted.err || deleted.out}` : null;
}
export async function startJjWorktree(root: string, branch: string, cfg: JjPolicy) {
  const state = await preflight(root, cfg);
  if ("error" in state) return bad(state.error);
  const target = await startTarget(root, branch, state, cfg);
  if ("error" in target) return bad(target.error);
  return createWorkspace(state, target, branch, cfg);
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
  const state = await preflight(root, cfg);
  if ("error" in state) return bad(state.error);
  const candidate = await finishCandidate(state, cfg);
  if ("error" in candidate) return bad(candidate.error);
  const mismatch = await verifyWorkspace(state, candidate);
  if (mismatch) return bad(mismatch);
  const removed = await jj(state.primary, ["workspace", "remove", candidate.name]);
  if (removed.code) return bad(removed.err || removed.out);
  if (!deleteBranch) return { ok: true, message: `removed merged Jujutsu workspace ${state.current}` };
  const deletionError = await deleteBookmark(state, candidate, cfg);
  return deletionError ? bad(deletionError) : { ok: true, message: `removed merged Jujutsu workspace ${state.current} and bookmark ${candidate.branch}` };
}
