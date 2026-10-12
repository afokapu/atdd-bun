import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { concreteProfiles, enabledProfiles, enforce, normalizeProfileName, profileConventions, type ConcreteProfile } from "./enforce";
import { activationContextDigest, canonicalFindingPath, compareFindings, contextDigest, findingFingerprint, isStrictProfileExpansion, parseRatchetPolicy, type FindingIdentity } from "./ratchet";
import { topologyFor } from "./topology";
import { JOURNEY_DOCS_DIR } from "./journey-docs";

export type WorktreePolicy = { enabled: boolean; root: string; primary_directory: string; primary_branch: string; require_linked_worktree: boolean };
export type HookPolicy = { max_staged_files: number; max_staged_changed_lines: number; max_commits_per_push: number; max_registry_removed_lines: number; registry_paths: string[]; protected_branches: string[]; require_plan_reference: boolean; require_traceability: boolean; worktrees: WorktreePolicy };
export const defaultWorktreePolicy: WorktreePolicy = { enabled: false, root: "../worktrees/{repo}", primary_directory: ".", primary_branch: "main", require_linked_worktree: true };
export const defaultHookPolicy: HookPolicy = { max_staged_files: 20, max_staged_changed_lines: 350, max_commits_per_push: 10, max_registry_removed_lines: 350, registry_paths: ["plan/_*.yaml", "plan/_*.yml", "contracts/_*.yaml", "contracts/_*.yml"], protected_branches: ["main", "master"], require_plan_reference: true, require_traceability: true, worktrees: defaultWorktreePolicy };
export const hookEvents = ["pre-commit", "commit-msg", "pre-push", "pre-merge-commit", "post-commit", "post-merge"] as const;
export type HookEvent = typeof hookEvents[number];
// Git exports these repository-local variables to hooks. A temporary worktree must discover its own Git directory instead.
const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_QUARANTINE_PATH"].includes(key)));
const git = async (root: string, args: string[], input?: string, raw = false) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, env: gitEnvironment, stdin: input ? new Blob([input]) : undefined, stdout: "pipe", stderr: "pipe" }); const out = await new Response(child.stdout).text(), err = await new Response(child.stderr).text(); return { code: await child.exited, out: raw ? out : out.trim(), err: raw ? err : err.trim() }; };
const bad = (message: string) => ({ ok: false, message });
const files = async (root: string, args: string[]) => (await git(root, args)).out.split("\n").filter(Boolean);
const strings = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : undefined;
// Declarative registries are exempt from the micro-commit size caps but never from validation or removal approval.
const isRegistry = (cfg: HookPolicy, path: string) => cfg.registry_paths.some(pattern => new Bun.Glob(pattern).match(path));
/** The path a rename row of `git diff --numstat -M` lands on: `a => b`, or `dir/{a => b}/file`. */
const renamedTo = (path: string) => { const braced = path.match(/^(.*)\{(.*) => (.*)\}(.*)$/); return braced ? `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/{2,}/g, "/") : path.includes(" => ") ? path.split(" => ")[1]! : path; };
/** Lines a commit changes, for the size cap: a moved file counts only the edits it carries, not its whole body twice. */
const stagedLineStats = async (root: string) => (await git(root, ["diff", "--cached", "--numstat", "-M"])).out.split("\n").filter(Boolean).map(row => { const [added, removed, ...path] = row.split("\t"); return { added: Number(added) || 0, removed: Number(removed) || 0, path: renamedTo(path.join("\t")) }; });
/** The journey view atdd-bun generates. Like a registry it is exempt from the size caps, since its index alone can
 * exceed them and it cannot be split; unlike hand-written docs it is never exempt from the docs profile, which refuses
 * a copy that is not byte-for-byte what the plan generates. */
const isGeneratedView = (path: string) => path.startsWith(`${JOURNEY_DOCS_DIR}/`);
const stagedStats = async (root: string) => (await git(root, ["diff", "--cached", "--numstat", "--no-renames"])).out.split("\n").filter(Boolean).map(row => { const [added, removed, ...path] = row.split("\t"); return { added: Number(added) || 0, removed: Number(removed) || 0, path: path.join("\t") }; });

export async function policy(root: string): Promise<HookPolicy> { const file = join(root, "atdd-bun.yaml"); if (!existsSync(file)) return defaultHookPolicy; return parsePolicy(await readFile(file, "utf8")); }
function parsePolicy(text: string): HookPolicy { const data = Bun.YAML.parse(text) as Record<string, unknown>; const configuredWorktrees = data?.worktrees && typeof data.worktrees === "object" && !Array.isArray(data.worktrees) ? data.worktrees as Record<string, unknown> : {}; return { ...defaultHookPolicy, ...Object.fromEntries(Object.entries(data ?? {}).filter(([key, value]) => key in defaultHookPolicy && key !== "worktrees" && typeof value === typeof (defaultHookPolicy as any)[key])), protected_branches: strings(data?.protected_branches) ?? defaultHookPolicy.protected_branches, registry_paths: strings(data?.registry_paths) ?? defaultHookPolicy.registry_paths, worktrees: { ...defaultWorktreePolicy, ...Object.fromEntries(Object.entries(configuredWorktrees).filter(([key, value]) => key in defaultWorktreePolicy && typeof value === typeof (defaultWorktreePolicy as any)[key])) } }; }
/** One mapping serves ordinary validation, strict pre-push, and the commit ratchet gate so their affected-area decisions cannot drift. */
async function affectedProfiles(root: string, changed: string[], registryChanged = false) {
  const profiles: ConcreteProfile[] = [], topology = await topologyFor(root);
  if (registryChanged || changed.some(path => path.startsWith(`${topology.planRoot}/`)) || changed.includes("atdd-bun.yaml")) profiles.push("planner", "traceability");
  if (changed.some(path => /\.(?:[cm]?[jt]sx?|html)$/.test(path))) profiles.push("coder", "tester");
  if (changed.includes("atdd-bun.yaml") || changed.some(path => /\.ya?ml$/.test(path))) profiles.push("topology");
  if (changed.some(isGeneratedView)) profiles.push("docs");
  return [...new Set(profiles)];
}
/** Detector inputs that can shift findings outside one changed area must retain the conservative full ratchet profile set. */
const fullCommitRatchetInputs = ["package.json", "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bunfig.toml"];
const needsFullCommitRatchetProfiles = (path: string) => path === "atdd-bun.yaml" || fullCommitRatchetInputs.includes(basename(path)) || /^tsconfig.*\.json$/.test(basename(path));
async function validation(root: string, changed: string[], full: boolean, registryChanged = false) { const profiles = await affectedProfiles(root, changed, registryChanged); if (!profiles.length) return { ok: true, message: "no affected area" }; try { const enabled = await enabledProfiles(root), selected = full ? ["all" as const] : profiles.filter(profile => enabled.includes(profile as any)); if (!selected.length) return { ok: true, message: "no activated profile covers the affected area" }; const findings = await enforce({ root, profiles: selected }); return findings.length ? bad(findings.map(f => `${f.rule_id}: ${f.file}`).join("\n")) : { ok: true, message: "validation clean" }; } catch (error) { return bad(`Bun enforcer resolution failed: ${String(error)}`); } }

const stable = (profiles: string[]) => [...new Set(profiles)].sort();
const configAt = async (root: string) => {
  const file = join(root, "atdd-bun.yaml");
  return existsSync(file) ? Bun.YAML.parse(await readFile(file, "utf8")) as Record<string, unknown> : {};
};

/** A staged reject-new policy compares its exact HEAD: equal active profiles are ordinary ratchet flow; strict expansion is the one bootstrap exception. */
async function ratchetCommitGate(root: string, staged: string[], registryChanged: boolean): Promise<{ ok: boolean; message: string } | null> {
  const stagedConfig = await git(root, ["show", ":atdd-bun.yaml"]);
  if (stagedConfig.code) return null;
  let candidateConfig: Record<string, unknown>, policy;
  try { candidateConfig = Bun.YAML.parse(stagedConfig.out) as Record<string, unknown>; policy = parseRatchetPolicy(candidateConfig); }
  catch (error) { return bad(`ratchet activation commit gate configuration is invalid: ${String(error)}`); }
  if (policy?.mode !== "reject-new" || !Array.isArray(candidateConfig.profiles) || !candidateConfig.profiles.every(profile => typeof profile === "string")) return null;
  if ((await git(root, ["diff", "--quiet"])).code !== 0 || (await git(root, ["ls-files", "--others", "--exclude-standard"])).out) return bad("ratchet activation commit gate requires no unstaged or untracked candidate state");
  const head = await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (head.code || !/^[0-9a-f]{40}$/i.test(head.out)) return bad("ratchet activation commit gate requires an exact committed HEAD base");
  const scratch = await mkdtemp(join(tmpdir(), "atdd-ratchet-commit-gate-"));
  try {
    const added = await git(root, ["worktree", "add", "--detach", "--no-checkout", scratch, head.out]);
    if (added.code) return bad(`could not materialize ratchet activation base: ${added.err || added.out}`);
    const checkedOut = await git(scratch, ["checkout", "--detach", head.out]);
    if (checkedOut.code) return bad(`could not checkout ratchet activation base: ${checkedOut.err || checkedOut.out}`);
    const baseConfig = await configAt(scratch), candidateProfiles = stable(candidateConfig.profiles.map(normalizeProfileName));
    const baseProfiles = stable(await enabledProfiles(scratch));
    const policyMatches = stable(policy.profiles.map(normalizeProfileName)).join(",") === candidateProfiles.join(",");
    const activation = isStrictProfileExpansion(baseProfiles, candidateProfiles) && activationContextDigest(baseConfig) === activationContextDigest(candidateConfig);
    const unchanged = baseProfiles.join(",") === candidateProfiles.join(",") && contextDigest(baseConfig, baseProfiles) === contextDigest(candidateConfig, candidateProfiles);
    if (candidateProfiles.some(profile => !concreteProfiles.includes(profile as typeof concreteProfiles[number])) || !policyMatches || (!activation && !unchanged)) return bad("ratchet reject-new requires either unchanged explicit profiles/context or an explicit monotonic profile expansion with identical non-profile context");
    const selectedProfiles = activation || staged.some(needsFullCommitRatchetProfiles) ? candidateProfiles : (await affectedProfiles(root, staged, registryChanged)).filter(profile => candidateProfiles.includes(profile));
    const tree = await git(root, ["write-tree"]);
    if (tree.code || !/^[0-9a-f]{40}$/i.test(tree.out)) return bad(`could not identify staged ratchet activation candidate: ${tree.err || tree.out}`);
    const baseTree = await git(root, ["rev-parse", "--verify", `${head.out}^{tree}`]);
    if (baseTree.code || !/^[0-9a-f]{40}$/i.test(baseTree.out)) return bad(`could not identify ratchet activation base tree: ${baseTree.err || baseTree.out}`);
    const normalize = (findings: Awaited<ReturnType<typeof enforce>>) => findings.map(finding => ({ ...finding, file: canonicalFindingPath(scratch, finding.file) }));
    // Scan and cache the unpatched HEAD before materializing the staged candidate; both keys remain exact Git trees.
    const cacheDirectory = await findingsCacheDirectory(root), toolkit = await toolkitIdentity().catch(() => null);
    const findingsAt = async (treeId: string) => cachedFindings(cacheDirectory, treeId, toolkit, selectedProfiles, async () => normalize(await enforce({ root: scratch, profiles: selectedProfiles as any })));
    const baseFindings = selectedProfiles.length ? await findingsAt(baseTree.out) : [];
    const patch = await git(root, ["diff", "--cached", "--binary"], undefined, true);
    if (patch.code) return bad(`could not read staged ratchet activation candidate: ${patch.err || patch.out}`);
    const applied = await git(scratch, ["apply", "--whitespace=nowarn"], patch.out);
    if (applied.code) return bad(`could not materialize staged ratchet activation candidate: ${applied.err || applied.out}`);
    const materialized = await configAt(scratch), materializedProfiles = stable(await enabledProfiles(scratch));
    const materializedContext = activation ? activationContextDigest(materialized) === activationContextDigest(candidateConfig) : materializedProfiles.join(",") === candidateProfiles.join(",") && contextDigest(materialized, materializedProfiles) === contextDigest(candidateConfig, candidateProfiles);
    if (!materializedContext) return bad("staged ratchet candidate did not materialize exactly");
    const candidateFindings = selectedProfiles.length ? await findingsAt(tree.out) : [];
    const delta = compareFindings(baseFindings, candidateFindings);
    const report = JSON.stringify({ schema: "atdd-bun.ratchet-report/v1", mode: policy.mode, base: head.out, candidate: tree.out, profiles: selectedProfiles, context: contextDigest(candidateConfig, candidateProfiles), ...delta });
    return { ok: delta.new.length === 0, message: report };
  } catch (error) { return bad(`ratchet activation commit gate failed closed: ${String(error)}`); }
  finally { await git(root, ["worktree", "remove", "--force", scratch]); await rm(scratch, { recursive: true, force: true }); }
}

/** A pushed reject-new candidate is judged from its immutable object IDs, never the hook's checkout or index. */
const exactProfiles = (config: Record<string, unknown>, label: string) => {
  if (!Array.isArray(config.profiles) || !config.profiles.length || !config.profiles.every(profile => typeof profile === "string")) throw new Error(`${label} must declare a non-empty explicit profiles list`);
  const profiles = config.profiles as string[];
  if (profiles.some(profile => normalizeProfileName(profile) !== profile || !concreteProfiles.includes(profile as typeof concreteProfiles[number]))) throw new Error(`${label} lists an unknown or legacy profile`);
  if (new Set(profiles).size !== profiles.length) throw new Error(`${label} lists duplicate profiles`);
  return stable(profiles);
};

async function checkoutCommit(root: string, directory: string, commit: string, label: string) {
  const added = await git(root, ["worktree", "add", "--detach", "--no-checkout", directory, commit]);
  if (added.code) throw new Error(`could not materialize ${label}: ${added.err || added.out}`);
  const checkedOut = await git(directory, ["checkout", "--detach", commit]);
  if (checkedOut.code) throw new Error(`could not checkout ${label}: ${checkedOut.err || checkedOut.out}`);
}

/** Compare exactly the remote tip and advertised local tip for one reject-new ref update. */
async function deletionPushGate(root: string, remote: string | undefined) {
  if (!remote || !/^[0-9a-f]{40}$/i.test(remote)) return bad("pre-push deletion requires an exact remote commit");
  const resolved = await git(root, ["rev-parse", "--verify", `${remote}^{commit}`]);
  return resolved.code || resolved.out.toLowerCase() !== remote.toLowerCase() ? bad(`pre-push deletion remote commit ${remote} is unavailable or not exact`) : { ok: true, message: "deletion validated" };
}

async function strictPushGate(root: string, candidate: string, range: string) {
  if (!/^[0-9a-f]{40}$/i.test(candidate)) return bad("strict pre-push validation requires an exact local candidate commit");
  const resolved = await git(root, ["rev-parse", "--verify", `${candidate}^{commit}`]);
  if (resolved.code || resolved.out.toLowerCase() !== candidate.toLowerCase()) return bad(`strict pre-push candidate ${candidate} is unavailable or not a full exact commit`);
  const candidateRoot = await mkdtemp(join(tmpdir(), "atdd-strict-push-candidate-"));
  try {
    await checkoutCommit(root, candidateRoot, candidate, "strict pre-push candidate");
    // The same affected-area selection as pre-commit, judged against the candidate's own registry policy.
    const changed = await files(candidateRoot, ["diff", "--name-only", range]), cfg = await policy(candidateRoot);
    return await validation(candidateRoot, changed, false, changed.some(path => isRegistry(cfg, path)));
  } catch (error) { return bad(`strict pre-push gate failed closed: ${String(error)}`); }
  finally { await git(root, ["worktree", "remove", "--force", candidateRoot]); await rm(candidateRoot, { recursive: true, force: true }); }
}

/** Remote-tracking tips of the protected branches for the push remote; local branches may hold unpushed commits and never count. */
async function protectedRemoteTips(root: string, protectedBranches: string[], remote: string | undefined): Promise<{ tips: string[] } | { error: string }> {
  const listed = await git(root, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes/"]);
  if (listed.code) return { error: listed.err || listed.out };
  const remotes = (await git(root, ["remote"])).out.split("\n").filter(Boolean), pushRemote = remote && remotes.includes(remote) ? remote : undefined;
  const tips = listed.out.split("\n").filter(Boolean).flatMap(row => {
    const [ref, sha] = row.split(" "), parts = ref!.split("/");
    return parts[2] && (!pushRemote || parts[2] === pushRemote) && protectedBranches.includes(parts.slice(3).join("/")) && /^[0-9a-f]{40}$/i.test(sha ?? "") ? [sha!.toLowerCase()] : [];
  });
  return { tips: [...new Set(tips)] };
}

/** Commits already on the push remote do not count: protected tips plus the SHAs the remote itself advertises for refs/heads/* (one ls-remote per push) whose commit exists locally. Local tracking SHAs, stale refs and local branches never exempt; an unreadable remote falls back to protected tips only. */
async function countExclusionTips(root: string, protectedBranches: string[], remote: string | undefined): Promise<{ tips: string[] } | { error: string }> {
  const protectedTips = await protectedRemoteTips(root, protectedBranches, remote);
  if ("error" in protectedTips) return protectedTips;
  const remotes = (await git(root, ["remote"])).out.split("\n").filter(Boolean);
  if (!remote || !remotes.includes(remote)) return protectedTips;
  const advertised = await git(root, ["ls-remote", "--heads", remote]);
  if (advertised.code) return protectedTips;
  const shas = [...new Set(advertised.out.split("\n").filter(Boolean).flatMap(row => { const [sha, ref] = row.split(/\s+/); return ref?.startsWith("refs/heads/") && /^[0-9a-f]{40}$/i.test(sha ?? "") ? [sha!.toLowerCase()] : []; }))];
  const present = (await Promise.all(shas.map(async sha => (await git(root, ["cat-file", "-e", `${sha}^{commit}`])).code ? [] : [sha]))).flat();
  return { tips: [...new Set([...protectedTips.tips, ...present])] };
}

/** A brand-new remote branch is ratcheted against the one protected remote-tracking tip that is an exact ancestor of the candidate. */
async function protectedAncestors(root: string, candidate: string, protectedBranches: string[], remote: string | undefined): Promise<{ ancestors: string[] } | { error: string }> {
  const found = await protectedRemoteTips(root, protectedBranches, remote);
  if ("error" in found) return { error: `could not list protected branch tips for the new remote branch: ${found.error}` };
  const ancestors = new Set<string>();
  for (const tip of found.tips) if ((await git(root, ["merge-base", "--is-ancestor", tip, candidate])).code === 0) ancestors.add(tip);
  return { ancestors: [...ancestors] };
}

async function newBranchBase(root: string, candidate: string, protectedBranches: string[], remote: string | undefined): Promise<{ base: string } | { error: string }> {
  const found = await protectedAncestors(root, candidate, protectedBranches, remote);
  if ("error" in found) return found;
  if (!found.ancestors.length) return { error: "ratchet new remote branch requires a protected branch tip that is an exact ancestor of the pushed candidate; none found" };
  if (found.ancestors.length > 1) return { error: `ratchet new remote branch base is ambiguous: ${found.ancestors.length} protected branch tips qualify with different commits` };
  return { base: found.ancestors[0]! };
}

/** For an existing remote branch the protected ancestor tip also counts as carried: CI judges against the protected base. */
async function existingBranchProtectedBase(root: string, candidate: string, remoteBase: string, protectedBranches: string[], remote: string | undefined): Promise<{ base: string | null } | { error: string }> {
  const found = await protectedAncestors(root, candidate, protectedBranches, remote);
  if ("error" in found) return found;
  if (found.ancestors.length > 1) return { error: `ratchet existing remote branch protected base is ambiguous: ${found.ancestors.length} protected branch tips qualify with different commits` };
  const tip = found.ancestors[0];
  return { base: tip && tip !== remoteBase.toLowerCase() ? tip : null };
}

/** Ratchet findings depend only on the scanned tree, the toolkit scanning it and the selected profiles, so they are cached
 * under the Git common directory. An entry is advisory: unreadable, malformed or differently keyed means recompute, never clean. */
const packageRoot = resolve(import.meta.dir, ".."), toolkitInputs = ["package.json", "relationships.yaml", "src", "lib", "detectors", "conventions", "planner-nodes", "planner-schemas"];
export type ToolkitIdentity = { version: string; digest: string };
async function toolkitFiles() {
  const found = new Set<string>();
  for (const input of toolkitInputs) {
    const path = join(packageRoot, input);
    if (!existsSync(path)) continue;
    if ((await stat(path)).isFile()) { found.add(input); continue; }
    for await (const file of new Bun.Glob("**/*").scan({ cwd: path, onlyFiles: true, dot: true })) found.add(`${input}/${file.replaceAll("\\", "/")}`);
  }
  // Companion conventions (the Flow lifecycle) live outside this package but still shape findings.
  for (const { path } of Object.values(profileConventions).flat()) found.add(path);
  return [...found].sort();
}
async function computeToolkitIdentity(): Promise<ToolkitIdentity> {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const file of await toolkitFiles()) { const full = resolve(packageRoot, file); hasher.update(`${file}\0`).update(existsSync(full) ? await readFile(full) : "\0missing").update("\0"); }
  const version = (JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { version?: unknown }).version;
  return { version: typeof version === "string" ? version : "unknown", digest: hasher.digest("hex") };
}
let identity: Promise<ToolkitIdentity> | undefined;
/** The running toolkit's package version and a digest of every detector/convention input, computed once per process. */
export function toolkitIdentity(): Promise<ToolkitIdentity> { return identity ??= computeToolkitIdentity(); }
const cachedEntry = (text: string, key: string): FindingIdentity[] | null => {
  const entry = JSON.parse(text) as { schema?: unknown; key?: unknown; findings?: unknown };
  if (entry?.schema !== "atdd-bun.findings-cache/v1" || JSON.stringify(entry.key) !== key || !Array.isArray(entry.findings)) return null;
  const valid = entry.findings.every(finding => finding && typeof finding.rule_id === "string" && typeof finding.file === "string" && findingFingerprint(finding));
  return valid ? entry.findings : null;
};
/** Findings for one exact tree: reuse a valid entry, otherwise compute and record the result for the next push. */
async function findingsCacheDirectory(root: string): Promise<string | null> {
  const common = await git(root, ["rev-parse", "--git-common-dir"]);
  return common.code || !common.out ? null : join(resolve(root, common.out), "atdd-bun", "findings-cache");
}
async function cachedFindings(directory: string | null, tree: string, toolkit: ToolkitIdentity | null, profiles: string[], compute: () => Promise<FindingIdentity[]>): Promise<FindingIdentity[]> {
  if (!directory || !toolkit || !/^[0-9a-f]{40}$/i.test(tree)) return compute();
  const key = JSON.stringify({ schema: "atdd-bun.findings-cache-key/v1", tree: tree.toLowerCase(), version: toolkit.version, digest: toolkit.digest, profiles: stable(profiles) });
  const file = join(directory, `${new Bun.CryptoHasher("sha256").update(key).digest("hex")}.json`);
  const hit = await readFile(file, "utf8").then(text => cachedEntry(text, key)).catch(() => null);
  if (hit) return hit;
  const findings = await compute(), scratch = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true }).then(() => writeFile(scratch, JSON.stringify({ schema: "atdd-bun.findings-cache/v1", key: JSON.parse(key), findings }))).then(() => rename(scratch, file)).catch(() => rm(scratch, { force: true }));
  return findings;
}

async function ratchetPushGate(root: string, remoteBase: string, candidate: string, protectedBranches: string[], remote: string | undefined): Promise<{ ok: boolean; message: string } | null> {
  let base = remoteBase;
  if (!/^[0-9a-f]{40}$/i.test(candidate)) return bad("ratchet reject-new requires an exact local candidate commit");
  const resolvedCandidate = await git(root, ["rev-parse", "--verify", `${candidate}^{commit}`]);
  if (resolvedCandidate.code || resolvedCandidate.out.toLowerCase() !== candidate.toLowerCase()) return bad(`ratchet candidate ${candidate} is unavailable or not a full exact commit`);
  const baseRoot = await mkdtemp(join(tmpdir(), "atdd-ratchet-push-base-")), protectedRoot = await mkdtemp(join(tmpdir(), "atdd-ratchet-push-protected-")), candidateRoot = await mkdtemp(join(tmpdir(), "atdd-ratchet-push-candidate-"));
  try {
    await checkoutCommit(root, candidateRoot, candidate, "ratchet candidate");
    const candidateConfig = await configAt(candidateRoot);
    let policy;
    try { policy = parseRatchetPolicy(candidateConfig); }
    catch (error) { return bad(`ratchet pushed candidate policy is invalid: ${String(error)}`); }
    if (!policy || policy.mode !== "reject-new") return null;
    let protectedBase: string | null = null;
    if (!/^0+$/.test(remoteBase)) { const found = await existingBranchProtectedBase(root, candidate, remoteBase, protectedBranches, remote); if ("error" in found) return bad(found.error); protectedBase = found.base; }
    if (/^0+$/.test(remoteBase)) { const found = await newBranchBase(root, candidate, protectedBranches, remote); if ("error" in found) return bad(found.error); base = found.base; }
    if (!/^[0-9a-f]{40}$/i.test(base)) return bad("ratchet reject-new requires an exact non-zero remote commit base");
    const resolvedBase = await git(root, ["rev-parse", "--verify", `${base}^{commit}`]);
    if (resolvedBase.code || resolvedBase.out.toLowerCase() !== base.toLowerCase()) return bad(`ratchet remote base ${base} is unavailable or not a full exact commit`);
    if ((await git(root, ["merge-base", "--is-ancestor", base, candidate])).code) return bad("ratchet remote base must be an ancestor of the pushed candidate");
    await checkoutCommit(root, baseRoot, base, "ratchet remote base");
    const baseConfig = await configAt(baseRoot);
    let basePolicy;
    try { basePolicy = baseConfig.ratchet === undefined ? null : parseRatchetPolicy(baseConfig); }
    catch (error) { return bad(`ratchet remote base policy is invalid: ${String(error)}`); }
    let baseProfiles: string[], candidateProfiles: string[], policyProfiles: string[], basePolicyProfiles: string[] | null;
    try {
      baseProfiles = baseConfig.profiles === undefined ? stable(await enabledProfiles(baseRoot)) : exactProfiles(baseConfig, "ratchet remote base");
      candidateProfiles = exactProfiles(candidateConfig, "ratchet pushed candidate");
      policyProfiles = exactProfiles({ profiles: policy.profiles }, "ratchet policy");
      basePolicyProfiles = basePolicy ? exactProfiles({ profiles: basePolicy.profiles }, "ratchet remote base policy") : null;
    } catch (error) { return bad(`ratchet pushed range profile state is invalid: ${String(error)}`); }
    const activation = isStrictProfileExpansion(baseProfiles, candidateProfiles) && activationContextDigest(baseConfig) === activationContextDigest(candidateConfig);
    const unchanged = baseProfiles.join(",") === candidateProfiles.join(",") && (!basePolicyProfiles || basePolicyProfiles.join(",") === baseProfiles.join(",")) && contextDigest(baseConfig, baseProfiles) === contextDigest(candidateConfig, candidateProfiles);
    if (policyProfiles.join(",") !== candidateProfiles.join(",") || (!activation && !unchanged)) return bad("ratchet remote base and pushed candidate profile/context differ");
    const normalize = (findings: Awaited<ReturnType<typeof enforce>>, directory: string) => findings.map(finding => ({ ...finding, file: canonicalFindingPath(directory, finding.file) }));
    let protectedUsed: string | null = null;
    if (protectedBase) {
      await checkoutCommit(root, protectedRoot, protectedBase, "ratchet protected base");
      const protectedConfig = await configAt(protectedRoot);
      // Only a protected tip judged under the same profile/context as the candidate is comparable; otherwise the remote tip alone decides.
      if (contextDigest(protectedConfig, candidateProfiles) === contextDigest(candidateConfig, candidateProfiles)) protectedUsed = protectedBase;
    }
    // Findings of an exact tree are reused across pushes; uncached enforcements run one at a time to cap peak processes.
    const cacheDirectory = await findingsCacheDirectory(root);
    const toolkit = await toolkitIdentity().catch(() => null);
    const findingsAt = async (directory: string, commit: string) => {
      const tree = await git(root, ["rev-parse", "--verify", `${commit}^{tree}`]);
      return cachedFindings(cacheDirectory, tree.code ? "" : tree.out, toolkit, candidateProfiles, async () => normalize(await enforce({ root: directory, profiles: candidateProfiles as any }), directory));
    };
    const baseFindings = await findingsAt(baseRoot, base);
    const protectedFindings = protectedUsed ? await findingsAt(protectedRoot, protectedUsed) : [];
    const candidateFindings = await findingsAt(candidateRoot, candidate);
    const delta = compareFindings([...baseFindings, ...protectedFindings], candidateFindings);
    return { ok: delta.new.length === 0, message: JSON.stringify({ schema: "atdd-bun.ratchet-report/v1", mode: policy.mode, base, ...(protectedUsed ? { protected_base: protectedUsed } : {}), candidate, profiles: candidateProfiles, context: contextDigest(candidateConfig, candidateProfiles), ...delta }) };
  } catch (error) { return bad(`ratchet pre-push gate failed closed: ${String(error)}`); }
  finally {
    await git(root, ["worktree", "remove", "--force", baseRoot]);
    await git(root, ["worktree", "remove", "--force", protectedRoot]);
    await git(root, ["worktree", "remove", "--force", candidateRoot]);
    await Promise.all([rm(baseRoot, { recursive: true, force: true }), rm(protectedRoot, { recursive: true, force: true }), rm(candidateRoot, { recursive: true, force: true })]);
  }
}

const inside = (parent: string, child: string) => { const path = relative(parent, child); return path === "" || (path !== ".." && !path.startsWith("../") && !path.startsWith("..\\")); };
async function primaryRoot(root: string): Promise<string | null> { const result = await git(root, ["rev-parse", "--git-common-dir"]); if (result.code) return null; return dirname(resolve(root, result.out)); }
async function primaryPolicy(root: string): Promise<HookPolicy> { const primary = await primaryRoot(await realpath(resolve(root))); if (!primary) return defaultHookPolicy; const committed = await git(primary, ["show", "HEAD:atdd-bun.yaml"]); return committed.code ? defaultHookPolicy : parsePolicy(committed.out); }
export type WorktreeLayout = { primary: string; worktreeRoot: string; current: string; branch: string };
async function layout(root: string, cfg: WorktreePolicy): Promise<WorktreeLayout | { error: string }> { const current = await realpath(resolve(root)), commonRoot = await primaryRoot(current); if (!commonRoot) return { error: "not inside a Git worktree" }; const primary = await realpath(commonRoot), expectedPrimary = cfg.primary_directory === "." ? primary : join(dirname(primary), cfg.primary_directory); if (primary !== expectedPrimary) return { error: `primary checkout must be ${expectedPrimary}, not ${primary}` }; const branch = (await git(primary, ["symbolic-ref", "--quiet", "--short", "HEAD"])).out; if (branch !== cfg.primary_branch) return { error: `primary checkout ${primary} must be on ${cfg.primary_branch}, not ${branch || "a detached HEAD"}` }; return { primary, worktreeRoot: resolve(primary, cfg.root.replaceAll("{repo}", basename(primary))), current, branch: (await git(current, ["symbolic-ref", "--quiet", "--short", "HEAD"])).out }; }
async function worktreeCommitPolicy(root: string, cfg: WorktreePolicy): Promise<string | null> { if (!cfg.enabled || !cfg.require_linked_worktree) return null; const state = await layout(root, cfg); if ("error" in state) return state.error; if (state.current === state.primary) return `commits must use a linked worktree beneath ${state.worktreeRoot}; run: atdd-bun worktree start <branch>`; if (!inside(state.worktreeRoot, state.current)) return `linked worktree ${state.current} is outside required root ${state.worktreeRoot}`; if (!state.branch) return "commits require a named branch, not a detached HEAD"; return null; }

export async function runHook(event: HookEvent, root = process.cwd(), args: string[] = [], stdin = "") {
  const cfg = await policy(root), branch = (await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])).out;
  if (["pre-commit", "pre-merge-commit"].includes(event) && cfg.protected_branches.includes(branch)) return bad(`protected branch ${branch} is blocked`);
  if (["pre-commit", "pre-merge-commit"].includes(event)) { const violation = await worktreeCommitPolicy(root, cfg.worktrees); if (violation) return bad(violation); }
  if (event === "pre-commit") { const staged = await files(root, ["diff", "--cached", "--name-only"]), registries = staged.filter(path => isRegistry(cfg, path)), generated = staged.filter(isGeneratedView), counted = staged.length - registries.length - generated.length, lines = (await stagedLineStats(root)).filter(row => !isRegistry(cfg, row.path) && !isGeneratedView(row.path)).reduce((n, row) => n + row.added + row.removed, 0); if (counted > cfg.max_staged_files) return bad(`staged files ${counted} exceed ${cfg.max_staged_files}`); if (lines > cfg.max_staged_changed_lines) return bad(`staged changed lines ${lines} exceed ${cfg.max_staged_changed_lines}`); const ratchet = await ratchetCommitGate(root, staged, registries.length > 0); if (ratchet) return ratchet; return cfg.require_traceability || registries.length || generated.length ? validation(root, staged, false, registries.length > 0) : { ok: true, message: "ok" }; }
  if (event === "commit-msg") { const deleted = (await files(root, ["diff", "--cached", "--name-only", "--diff-filter=D"])).length, stats = await stagedStats(root), lines = stats.reduce((n, row) => n + row.removed, 0), registryRemoved = stats.filter(row => isRegistry(cfg, row.path)).reduce((n, row) => n + row.removed - row.added, 0), message = args[0] && existsSync(args[0]) ? await readFile(args[0], "utf8") : "", approved = message.includes("[mass-delete-approved]"); if ((deleted > 50 || lines > 10_000) && !approved) return bad("mass delete requires [mass-delete-approved]"); return registryRemoved > cfg.max_registry_removed_lines && !approved ? bad(`registry removal of ${registryRemoved} net lines exceeds ${cfg.max_registry_removed_lines}; requires [mass-delete-approved]`) : { ok: true, message: "ok" }; }
  if (event === "pre-push") { const reports: string[] = []; let exclusions: Awaited<ReturnType<typeof countExclusionTips>> | undefined; for (const row of stdin.split("\n").filter(Boolean).map(row => row.split(/\s+/))) { const [, local, remote, remoteSha] = row, target = remote?.replace("refs/heads/", ""); if (target && cfg.protected_branches.includes(target)) return bad(`protected branch ${target} is blocked`); if (!local) return bad("pre-push update has no local object id"); if (/^0+$/.test(local)) { const deletion = await deletionPushGate(root, remoteSha); if (!deletion.ok) return deletion; continue; } const isNew = !remoteSha || /^0+$/.test(remoteSha), range = isNew ? `${local}^..${local}` : `${remoteSha}..${local}`, shared = exclusions ??= await countExclusionTips(root, cfg.protected_branches, args[0]); if ("error" in shared) return bad(`could not list remote branch tips for the pushed range ${range}: ${shared.error}`); const counted = await git(root, ["rev-list", "--count", ...(shared.tips.length ? [isNew ? local : range, "--not", ...shared.tips] : [range])]); if (counted.code || !/^\d+$/.test(counted.out)) return bad(`could not count commits in pushed range ${range}: ${counted.err || counted.out}`); if (Number(counted.out) > cfg.max_commits_per_push) return bad(`commits per push ${counted.out} exceed ${cfg.max_commits_per_push}`); const ratchet = remote?.startsWith("refs/heads/") ? await ratchetPushGate(root, remoteSha ?? "", local, cfg.protected_branches, args[0]) : null; if (ratchet) { if (!ratchet.ok) return ratchet; reports.push(ratchet.message); continue; } const strict = await strictPushGate(root, local, range); if (!strict.ok) return strict; } return reports.length ? { ok: true, message: reports.length === 1 ? reports[0]! : `[${reports.join(",")}]` } : { ok: true, message: "validation clean" }; }
  if (event === "post-commit") { const result = await validation(root, await files(root, ["show", "--pretty=format:", "--name-only", "HEAD"]), false); return { ok: true, message: result.ok ? result.message : `advisory: ${result.message}` }; }
  return { ok: true, message: "ok" };
}

// Resolve from the checkout at hook time: installed consumers use their local package; source checkouts use src.
const dispatcher = (event: HookEvent) => `#!/bin/sh\nroot="$(git rev-parse --show-toplevel)" || exit $?\nentry="$root/node_modules/@afokapu/atdd-bun/src/cli.ts"\nif [ ! -f "$entry" ]; then\n  if [ -f "$root/package.json" ] && grep -Eq '"name"[[:space:]]*:[[:space:]]*"@afokapu/atdd-bun"' "$root/package.json" && [ -f "$root/src/cli.ts" ]; then\n    entry="$root/src/cli.ts"\n  else\n    echo "atdd-bun hook: install @afokapu/atdd-bun in this project before running hooks" >&2\n    exit 1\n  fi\nfi\nexec bun "$entry" hook ${event} "$@"\n`;
export async function installHooks(root = process.cwd(), replace = false) { const current = (await git(root, ["config", "--worktree", "--get", "core.hooksPath"])).out || (await git(root, ["config", "--get", "core.hooksPath"])).out; if (current && current !== ".githooks" && !replace) return bad(`core.hooksPath is ${current}; use --replace`); await git(root, ["config", "extensions.worktreeConfig", "true"]); await mkdir(join(root, ".githooks"), { recursive: true }); for (const event of hookEvents) { const file = join(root, ".githooks", event); await writeFile(file, dispatcher(event)); await chmod(file, 0o755); } const result = await git(root, ["config", "--worktree", "core.hooksPath", ".githooks"]); return result.code ? bad(result.err) : { ok: true, message: "hooks installed" }; }
export async function uninstallHooks(root = process.cwd()) { if ((await git(root, ["config", "--worktree", "--get", "core.hooksPath"])).out === ".githooks") await git(root, ["config", "--worktree", "--unset", "core.hooksPath"]); for (const event of hookEvents) await rm(join(root, ".githooks", event), { force: true }); return { ok: true, message: "hooks uninstalled" }; }
export async function hooksStatus(root = process.cwd()) { const path = (await git(root, ["config", "--worktree", "--get", "core.hooksPath"])).out; return { ok: path === ".githooks" && hookEvents.every(event => existsSync(join(root, ".githooks", event))), message: path || "not installed" }; }

const branchPath = (branch: string) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
export async function startWorktree(root = process.cwd(), branch = "") { const cfg = await policy(root); if (!cfg.worktrees.enabled) return bad("worktree policy is disabled; set worktrees.enabled: true in atdd-bun.yaml"); const state = await layout(root, cfg.worktrees); if ("error" in state) return bad(state.error); if (state.current !== state.primary) return bad(`start must run from the primary checkout ${state.primary}`); if (!branch) return bad("branch is required: atdd-bun worktree start <branch>"); if ((await git(root, ["check-ref-format", "--branch", branch])).code) return bad(`invalid branch name ${JSON.stringify(branch)}`); if (cfg.protected_branches.includes(branch)) return bad(`cannot create a worktree for protected branch ${branch}`); const leaf = branchPath(branch); if (!leaf) return bad(`branch ${JSON.stringify(branch)} cannot form a safe worktree directory`); const target = join(state.worktreeRoot, leaf); if (existsSync(target)) return bad(`worktree path already exists: ${target}`); await mkdir(state.worktreeRoot, { recursive: true }); const created = await git(state.primary, ["worktree", "add", target, "-b", branch]); if (created.code) return bad(created.err || created.out); const hooks = await installHooks(target); if (!hooks.ok) return bad(`created ${target}, but could not install hooks: ${hooks.message}`); return { ok: true, message: `created linked worktree ${target} on ${branch}` }; }

export async function worktreeStatus(root = process.cwd()) { const cfg = await primaryPolicy(root); if (!cfg.worktrees.enabled) return bad("worktree policy is disabled"); const state = await layout(root, cfg.worktrees); if ("error" in state) return bad(state.error); const result = await git(state.primary, ["worktree", "list", "--porcelain"]); return result.code ? bad(result.err) : { ok: true, message: result.out }; }

async function generatedHooksOnly(root: string): Promise<boolean> { const directory = join(root, ".githooks"); if (!existsSync(directory)) return false; const names = (await readdir(directory)).sort(); if (names.join("\n") !== [...hookEvents].sort().join("\n")) return false; return (await Promise.all(hookEvents.map(async event => (await readFile(join(directory, event), "utf8")) === dispatcher(event)))).every(Boolean); }

export async function finishWorktree(root = process.cwd(), deleteBranch = false) { const cfg = await primaryPolicy(root); if (!cfg.worktrees.enabled) return bad("worktree policy is disabled"); const state = await layout(root, cfg.worktrees); if ("error" in state) return bad(state.error); if (state.current === state.primary || !inside(state.worktreeRoot, state.current)) return bad(`finish must run from a linked worktree beneath ${state.worktreeRoot}`); if (!state.branch || cfg.protected_branches.includes(state.branch)) return bad("finish requires a non-protected named branch"); const status = (await git(state.current, ["status", "--porcelain"])).out, generatedHooks = await generatedHooksOnly(state.current), onlyGeneratedHooks = Boolean(status) && status.split("\n").every(line => line.endsWith(" .githooks/") || line.endsWith(" .githooks")); if (status && !onlyGeneratedHooks) return bad("worktree is dirty; commit, stash, or discard changes before finish"); const tip = (await git(state.primary, ["rev-parse", "--verify", `refs/heads/${state.branch}`])).out.trim(); if (!tip || (await git(state.primary, ["merge-base", "--is-ancestor", tip, cfg.worktrees.primary_branch])).code) return bad(`branch ${state.branch} is not merged into ${cfg.worktrees.primary_branch} in the primary checkout`); const removed = await git(state.primary, ["worktree", "remove", ...(onlyGeneratedHooks && generatedHooks ? ["--force"] : []), state.current]); if (removed.code) return bad(removed.err || removed.out); if (deleteBranch) { const now = (await git(state.primary, ["rev-parse", "--verify", `refs/heads/${state.branch}`])).out.trim(); if (now !== tip || (await git(state.primary, ["merge-base", "--is-ancestor", tip, cfg.worktrees.primary_branch])).code) return bad(`worktree removed, but branch ${state.branch} was not deleted: its tip changed or is no longer merged into ${cfg.worktrees.primary_branch}`); const deleted = await git(state.primary, ["branch", "-D", state.branch]); if (deleted.code) return bad(`worktree removed, but branch deletion failed: ${deleted.err || deleted.out}`); } return { ok: true, message: `removed merged worktree ${state.current}${deleteBranch ? ` and branch ${state.branch}` : ""}` }; }
