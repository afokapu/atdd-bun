import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { deliveryInstalled, deliverySkillFiles, instructionPaths } from "./agent";
import { renderWorkflow } from "./ci";
import { loosenedDelivery } from "./delivery";
import { defaultHookPolicy, type HookPolicy } from "./hooks";

/**
 * Integrity: the files an agent could change to weaken enforcement must stay canonical.
 * The same check runs as a local test (a loud reminder the agent sees) and in CI on a
 * clean install (the verdict the agent cannot fake).
 */
export type IntegrityFinding = { file: string; detail: string; restore: string };
/** `push`: judge the newest commit against its parent (a push to the base branch). Defaults to GITHUB_EVENT_NAME === "push". */
export type IntegrityOptions = { root?: string; packageRoot?: string; base?: string; push?: boolean };

const PACKAGE = "@afokapu/atdd-bun";
const ownRoot = resolve(import.meta.dir, "..");
export const MANIFEST = "integrity.json";
export const TEST_FILE = "atdd-bun.integrity.test.ts";
const SKILLS = [".agents/skills/atdd/SKILL.md", ".claude/skills/atdd/SKILL.md"];
const WORKFLOW = ".github/workflows/atdd-bun.yml";
const BLOCK = /<!-- atdd-bun:start[\s\S]*?<!-- atdd-bun:end -->/;
// Generated files carry the version that wrote them; an upgrade must not read as tampering.
const unstamp = (text: string) => text.replace(/@afokapu\/atdd-bun (?:\d+\.\d+\.\d+(?:-[\w.]+)?|\{\{VERSION\}\})/g, "@afokapu/atdd-bun <version>").replace(/\r\n/g, "\n").trimEnd();
const sha256 = (data: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
/** Where `bun test` will find the generated test: the repository's `[test] root` from bunfig.toml, else the repo root. */
export async function testFilePath(repo: string) {
  const bunfig = join(repo, "bunfig.toml");
  const text = existsSync(bunfig) ? await readFile(bunfig, "utf8") : "";
  const root = text.split(/^\[/m).find(section => section.startsWith("test]"))?.match(/^\s*root\s*=\s*["']([^"']+)["']/m)?.[1];
  return join(repo, root ?? ".", TEST_FILE);
}
const git = async (root: string, args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); const out = (await new Response(child.stdout).text()).trim(); return { code: await child.exited, out }; };

async function filesBelow(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") out.push(...await filesBelow(path, base)); }
    else out.push(relative(base, path).split(sep).join("/"));
  }
  return out;
}

/** Hash every shipped file except the manifest itself and package.json, which npm normalizes on publish. */
export async function writeManifest(packageRoot = ownRoot, files?: string[]) {
  const pkg = await Bun.file(join(packageRoot, "package.json")).json() as { version: string };
  const list = (files ?? await filesBelow(packageRoot)).filter(file => file !== MANIFEST && file !== "package.json").sort();
  const hashes = Object.fromEntries(await Promise.all(list.map(async file => [file, sha256(await Bun.file(join(packageRoot, file)).bytes())])));
  await writeFile(join(packageRoot, MANIFEST), JSON.stringify({ version: pkg.version, files: hashes }, null, 2) + "\n");
  return list.length;
}

/** The installed package's files match the manifest published with it. Skipped when running from a source checkout. */
export async function checkInstalledPackage(packageRoot = ownRoot): Promise<IntegrityFinding[]> {
  if (!packageRoot.split(sep).includes("node_modules")) return [];
  const where = (file: string) => `node_modules/${PACKAGE}/${file}`, restore = "bun install --force";
  if (!existsSync(join(packageRoot, MANIFEST))) return [{ file: where(MANIFEST), detail: `the installed package has no ${MANIFEST}; it was not installed from the npm registry`, restore }];
  const manifest = await Bun.file(join(packageRoot, MANIFEST)).json() as { version: string; files: Record<string, string> };
  const findings: IntegrityFinding[] = [];
  const version = (await Bun.file(join(packageRoot, "package.json")).json() as { version: string }).version;
  if (version !== manifest.version) findings.push({ file: where("package.json"), detail: `installed version ${version} does not match the published manifest ${manifest.version}`, restore });
  for (const [file, hash] of Object.entries(manifest.files)) {
    const path = join(packageRoot, file);
    if (!existsSync(path)) findings.push({ file: where(file), detail: "was deleted from the installed package", restore });
    else if (sha256(await Bun.file(path).bytes()) !== hash) findings.push({ file: where(file), detail: `differs from the published ${manifest.version} package`, restore });
  }
  for (const file of await filesBelow(packageRoot)) if (file !== MANIFEST && file !== "package.json" && !(file in manifest.files)) findings.push({ file: where(file), detail: "was added to the installed package", restore });
  return findings;
}

/** The repository installs the package from npm, pinned by a registry integrity hash. */
async function checkDependency(root: string): Promise<IntegrityFinding[]> {
  if (!existsSync(join(root, "package.json"))) return [];
  const pkg = await Bun.file(join(root, "package.json")).json() as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  if (pkg.name === PACKAGE) return [];
  const spec = pkg.devDependencies?.[PACKAGE] ?? pkg.dependencies?.[PACKAGE];
  if (spec === undefined) return [{ file: "package.json", detail: `${PACKAGE} is not a dependency`, restore: `bun add -d ${PACKAGE}` }];
  const findings: IntegrityFinding[] = [];
  if (!/^[~^]?\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(spec)) findings.push({ file: "package.json", detail: `${PACKAGE} is "${spec}"; it must be an npm version range, not a git, file, or link source`, restore: `bun add -d ${PACKAGE}` });
  const lock = existsSync(join(root, "bun.lock")) ? await readFile(join(root, "bun.lock"), "utf8") : "";
  const entry = lock.split("\n").find(line => line.trimStart().startsWith(`"${PACKAGE}": [`));
  if (!entry) findings.push({ file: "bun.lock", detail: `bun.lock does not pin ${PACKAGE}`, restore: "bun install" });
  else if (!/"@afokapu\/atdd-bun@\d+\.\d+\.\d+[^"]*", ""/.test(entry) || !entry.includes('"sha512-')) findings.push({ file: "bun.lock", detail: `bun.lock does not resolve ${PACKAGE} from the npm registry with an integrity hash`, restore: `bun add -d ${PACKAGE}` });
  return findings;
}

/** Generated files are byte-identical to what the installed version generates (ignoring its version stamp). */
async function checkGenerated(root: string, packageRoot: string, skipWorkflow = false): Promise<IntegrityFinding[]> {
  const findings: IntegrityFinding[] = [];
  const same = async (file: string, template: string, restore: string) => {
    const path = join(root, file);
    if (!existsSync(path)) return findings.push({ file, detail: "is missing", restore });
    if (unstamp(await readFile(path, "utf8")) !== unstamp(await readFile(join(packageRoot, template), "utf8"))) findings.push({ file, detail: "was edited; it must match what the package generates", restore });
  };
  // The workflow is rendered per repository (its protected branches), so it is compared with that rendering.
  const workflow = join(root, WORKFLOW);
  if (skipWorkflow) { /* rendered from atdd-bun.yaml, which does not parse: reported by the caller */ }
  else if (!existsSync(workflow)) findings.push({ file: WORKFLOW, detail: "is missing", restore: "bun run atdd-bun ci init --replace" });
  else if (unstamp(await readFile(workflow, "utf8")) !== unstamp(await renderWorkflow(root))) findings.push({ file: WORKFLOW, detail: "was edited; it must match what the package generates (protected_branches decides its push branches)", restore: "bun run atdd-bun ci init --replace" });
  for (const skill of SKILLS) await same(skill, "templates/agents/atdd/SKILL.md", "bun run atdd-bun agent init --replace");
  // Required while delivery is adopted; protected whenever present, so turning delivery off and on cannot launder an edit.
  const adopted = await deliveryInstalled(root);
  for (const [path, template] of deliverySkillFiles) if (adopted || existsSync(join(root, path))) await same(path, `templates/agents/${template}`, "bun run atdd-bun agent init --replace");
  await same(relative(root, await testFilePath(root)), "templates/agents/atdd-bun.integrity.test.ts", "bun run atdd-bun integrity init --replace");
  const canonical = (await readFile(join(packageRoot, "templates/agents/AGENTS.block.md"), "utf8")).match(BLOCK)![0];
  for (const file of instructionPaths) {
    const agents = existsSync(join(root, file)) ? await readFile(join(root, file), "utf8") : "", block = agents.match(BLOCK)?.[0];
    if (!block) findings.push({ file, detail: "is missing the atdd-bun block", restore: "bun run atdd-bun agent init --replace" });
    else if (unstamp(block) !== unstamp(canonical)) findings.push({ file, detail: "atdd-bun block was edited", restore: "bun run atdd-bun agent init --replace" });
  }
  return findings;
}

/** The operator's explicit profile list, or null when atdd-bun.yaml declares none. Deliberately not enabledProfiles():
 * its absent-means-all default is right for execution and wrong for deciding whether a policy was ever declared. */
const explicitProfiles = (config: { profiles?: unknown }): string[] | null => Array.isArray(config.profiles) ? config.profiles.map(String) : null;

/** A policy with null-valued keys (top level and worktrees) removed: YAML gives null for a key with no value, and the
 * hooks read null as absent, so the comparison must too. */
function withoutNulls(config: Record<string, unknown>): Record<string, unknown> {
  const out = Object.fromEntries(Object.entries(config).filter(([, value]) => value !== null));
  const worktrees = out.worktrees;
  if (typeof worktrees === "object" && worktrees !== null && !Array.isArray(worktrees)) out.worktrees = Object.fromEntries(Object.entries(worktrees).filter(([, value]) => value !== null));
  return out;
}

/** The hook policy fields whose value has the wrong type. The comparison below would otherwise crash on them (a string
 * where a list is expected) or compare them as the defaults. An empty or null document is the default policy, and fine. */
export function policyShapeErrors(config: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["max_staged_files", "max_staged_changed_lines", "max_uncommitted_files", "max_commits_per_push", "max_registry_removed_lines"])
    if (config[key] !== undefined && !(typeof config[key] === "number" && Number.isFinite(config[key]))) out.push(`${key} must be a finite number`);
  for (const key of ["require_plan_reference", "require_traceability"]) if (config[key] !== undefined && typeof config[key] !== "boolean") out.push(`${key} must be true or false`);
  for (const key of ["protected_branches", "registry_paths"]) if (config[key] !== undefined && !(Array.isArray(config[key]) && (config[key] as unknown[]).every(item => typeof item === "string"))) out.push(`${key} must be a list of strings`);
  const worktrees = config.worktrees;
  if (worktrees !== undefined) {
    if (typeof worktrees !== "object" || worktrees === null || Array.isArray(worktrees)) out.push("worktrees must be a mapping");
    else for (const key of ["enabled", "require_linked_worktree"]) if ((worktrees as Record<string, unknown>)[key] !== undefined && typeof (worktrees as Record<string, unknown>)[key] !== "boolean") out.push(`worktrees.${key} must be true or false`);
  }
  return out;
}

/** Names of the policy fields in `current` that are looser than in `base`. */
export function loosenedPolicy(base: Partial<HookPolicy> & { profiles?: unknown; delivery?: unknown }, current: Partial<HookPolicy> & { profiles?: unknown; delivery?: unknown }): string[] {
  const b = { ...defaultHookPolicy, ...base, worktrees: { ...defaultHookPolicy.worktrees, ...base.worktrees } }, c = { ...defaultHookPolicy, ...current, worktrees: { ...defaultHookPolicy.worktrees, ...current.worktrees } };
  const out: string[] = [];
  for (const key of ["max_staged_files", "max_staged_changed_lines", "max_uncommitted_files", "max_commits_per_push", "max_registry_removed_lines"] as const) if (Number(c[key]) > Number(b[key])) out.push(`${key} ${b[key]} → ${c[key]}`);
  for (const key of ["require_plan_reference", "require_traceability"] as const) if (b[key] && !c[key]) out.push(`${key} true → false`);
  for (const key of ["enabled", "require_linked_worktree"] as const) if (b.worktrees[key] && !c.worktrees[key]) out.push(`worktrees.${key} true → false`);
  const removed = b.protected_branches.filter(x => !c.protected_branches.includes(x)), added = c.registry_paths.filter(x => !b.registry_paths.includes(x));
  if (removed.length) out.push(`protected_branches drops ${removed.join(", ")}`);
  if (added.length) out.push(`registry_paths adds ${added.join(", ")}`);
  // Profiles: an absent list runs every profile (enabledProfiles) but governs none. The first explicit list is the
  // adoption that establishes the governed set, not a drop. From then on, dropping a profile or removing the list
  // (explicit → implicit → narrower would otherwise be a two-step bypass) is loosening a human approves.
  const before = explicitProfiles(base), after = explicitProfiles(current);
  if (before && !after) out.push(`profiles becomes implicit: the explicit list [${before.join(", ")}] was removed`);
  const dropped = before && after ? before.filter(name => !after.includes(name)) : [];
  if (dropped.length) out.push(`profiles drops ${dropped.join(", ")}`);
  out.push(...loosenedDelivery(base, current));
  return out;
}

/** How to recover a baseline that cannot be resolved. A full object id (SHA-1 or SHA-256, any case) is fetched by id: after
 * a force push the replaced tip is on no branch. A shorter hex string may be an abbreviated SHA, which cannot be fetched,
 * or a branch or tag that merely looks like hex; anything else is a ref name, which a plain fetch brings. */
export function baselineRestore(ref: string): string {
  if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(ref)) return `git fetch origin ${ref}, then re-run the check (a plain fetch may not bring it: after a force push the replaced tip is on no branch)`;
  if (/^[0-9a-f]{4,39}$/i.test(ref)) return `if ${ref} is an abbreviated SHA, set ATDD_BASE_REF to its full SHA and git fetch origin <full SHA> (an abbreviated SHA cannot be fetched); if it is a branch or tag, git fetch origin; then re-run the check`;
  return `git fetch origin, then re-run the check`;
}

/** atdd-bun.yaml is not looser than on the branch being merged into. */
async function checkPolicy(root: string, base?: string, push = process.env.GITHUB_EVENT_NAME === "push"): Promise<IntegrityFinding[]> {
  // On a push, the generated CI passes the pre-push tip (github.event.before) as ATDD_BASE_REF, so a multi-commit push
  // is judged as a whole: [docs, security] → no list → [docs] in one push cannot read as a first adoption.
  const ref = base || process.env.ATDD_BASE_REF || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/HEAD");
  const newBranch = /^0+$/.test(ref), resolved = newBranch ? "" : (await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).out;
  let against: string;
  // An explicit baseline (the pre-push tip, the merge queue's target) that cannot be resolved fails closed.
  if (!newBranch && !resolved && (base || process.env.ATDD_BASE_REF)) return [{ file: "atdd-bun.yaml", detail: `cannot resolve the policy baseline ${ref} to judge this change against`, restore: baselineRestore(ref) }];
  if (push) {
    // A push is judged against the tip it replaced, directly, never a merge base: after a force push the merge base
    // can predate the policy being removed. A new branch has no previous tip and is judged against its parent.
    against = resolved && resolved !== (await git(root, ["rev-parse", "HEAD"])).out ? resolved : (await git(root, ["rev-parse", "--verify", "--quiet", "HEAD~1"])).out;
  } else {
    if (!resolved) return [];
    against = (await git(root, ["merge-base", "HEAD", ref])).out;
  }
  if (!against) return [];
  const read = async (text: string | null) => (text ? Bun.YAML.parse(text) ?? {} : {}) as Partial<HookPolicy>;
  const before = await git(root, ["show", `${against}:atdd-bun.yaml`]), path = join(root, "atdd-bun.yaml");
  // A baseline that does not parse, or parses to something other than a policy mapping, cannot be compared; reading it as
  // empty would compare against the defaults and could miss a loosening the baseline configured. It is a finding, as an
  // unreadable working-tree file is.
  const unreadable = (why: string) => [{ file: "atdd-bun.yaml", detail: `the baseline atdd-bun.yaml at ${against.slice(0, 7)} ${why}, so the policy cannot be compared`, restore: push
    ? `this push is compared with the tip it replaced (${against.slice(0, 7)}), whose atdd-bun.yaml is broken; once the repaired atdd-bun.yaml is on the branch, the next push is compared with a readable tip`
    : `repair the atdd-bun.yaml on the base branch (git show ${against.slice(0, 7)}:atdd-bun.yaml) and land it there, which may need a maintainer; then bring that repair into this branch (rebase onto the base, or merge it in: a pull request is compared with its merge base) and re-run the check` }];
  let baseline: Record<string, unknown>;
  try { baseline = await read(before.code ? null : before.out) as Record<string, unknown>; }
  catch (error) { return unreadable(`could not be parsed (${String(error)})`); }
  if (typeof baseline !== "object" || baseline === null || Array.isArray(baseline)) return unreadable(`is not a policy mapping (${JSON.stringify(baseline)})`);
  // A key with no value (or only commented-out children) parses to null; the hooks read it as absent, and so does this.
  baseline = withoutNulls(baseline);
  const baseShape = policyShapeErrors(baseline);
  if (baseShape.length) return unreadable(`has wrongly typed fields (${baseShape.join("; ")})`);
  const raw = await read(existsSync(path) ? await readFile(path, "utf8") : null);
  const current = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? withoutNulls(raw) : raw;
  // A wrongly typed field in the working tree is read by the hooks as its default, silently; it is reported instead.
  const shape = typeof current === "object" && current !== null && !Array.isArray(current) ? policyShapeErrors(current) : ["the document is not a policy mapping"];
  if (shape.length) return [{ file: "atdd-bun.yaml", detail: `has wrongly typed fields, which the hooks would ignore or misread: ${shape.join("; ")}`, restore: "correct the field types in atdd-bun.yaml, then re-run the check" }];
  const loosened = loosenedPolicy(baseline, current);
  return loosened.length ? [{ file: "atdd-bun.yaml", detail: `loosens the policy of ${against.slice(0, 7)}: ${loosened.join("; ")}`, restore: `git checkout ${against.slice(0, 7)} -- atdd-bun.yaml` }] : [];
}

export async function checkIntegrity(options: IntegrityOptions = {}): Promise<IntegrityFinding[]> {
  const root = resolve(options.root ?? process.cwd()), packageRoot = options.packageRoot ?? ownRoot;
  // An unreadable atdd-bun.yaml is a finding, not a crash: the policy and the workflow rendered from it cannot be
  // judged until it parses, and every other finding is kept.
  const config = join(root, "atdd-bun.yaml");
  let unreadable: IntegrityFinding | null = null;
  if (existsSync(config)) try { Bun.YAML.parse(await readFile(config, "utf8")); } catch (error) { unreadable = { file: "atdd-bun.yaml", detail: `could not be parsed, so the policy and the workflow's push branches cannot be judged: ${String(error)}`, restore: "fix the YAML syntax in atdd-bun.yaml, then re-run the check" }; }
  const base = [...await checkInstalledPackage(packageRoot), ...await checkDependency(root)];
  return unreadable ? [...base, ...await checkGenerated(root, packageRoot, true), unreadable] : [...base, ...await checkGenerated(root, packageRoot), ...await checkPolicy(root, options.base, options.push)];
}

/** The message both the local test and CI print: addressed to the agent, with the way back for every file. */
export function formatIntegrity(findings: IntegrityFinding[]): string {
  return [
    "",
    "⛔ ATDD INTEGRITY VIOLATION: protected files were changed.",
    "",
    `These files are owned by ${PACKAGE}. You are not allowed to edit them, weaken them,`,
    "or work around this check. Changing them means you are not following this repository's limits.",
    "",
    ...findings.flatMap(f => [`  ✗ ${f.file}: ${f.detail}`, `      restore: ${f.restore}`]),
    "",
    "Put every file above back to its canonical state before doing anything else.",
    "If a change here is genuinely needed, stop and ask the human. It belongs in the",
    `${PACKAGE} package or in a separate change the human approves, never in this one.`,
    "CI runs this same check on a clean install, so reverting only locally will not pass.",
    "",
  ].join("\n");
}

/** Write the generated integrity test into a repository. */
export async function integrityInit(repo = process.cwd(), replace = false) {
  const output = await testFilePath(repo);
  if (existsSync(output) && !replace) return { ok: false, message: `${output} exists; use --replace` };
  const version = (await Bun.file(join(ownRoot, "package.json")).json() as { version: string }).version;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, (await readFile(join(ownRoot, "templates/agents/atdd-bun.integrity.test.ts"), "utf8")).replace("{{VERSION}}", version));
  return { ok: true, message: output };
}
export async function integrityStatus(repo = process.cwd()) { const output = await testFilePath(repo); return { ok: existsSync(output), message: output }; }
