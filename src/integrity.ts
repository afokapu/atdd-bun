import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { instructionPaths } from "./agent";
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
async function checkGenerated(root: string, packageRoot: string): Promise<IntegrityFinding[]> {
  const findings: IntegrityFinding[] = [];
  const same = async (file: string, template: string, restore: string) => {
    const path = join(root, file);
    if (!existsSync(path)) return findings.push({ file, detail: "is missing", restore });
    if (unstamp(await readFile(path, "utf8")) !== unstamp(await readFile(join(packageRoot, template), "utf8"))) findings.push({ file, detail: "was edited; it must match what the package generates", restore });
  };
  await same(WORKFLOW, "templates/github/atdd-bun.yml", "bun run atdd-bun ci init --replace");
  for (const skill of SKILLS) await same(skill, "templates/agents/atdd/SKILL.md", "bun run atdd-bun agent init --replace");
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

/** Names of the policy fields in `current` that are looser than in `base`. */
export function loosenedPolicy(base: Partial<HookPolicy> & { profiles?: unknown }, current: Partial<HookPolicy> & { profiles?: unknown }): string[] {
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
  return out;
}

/** atdd-bun.yaml is not looser than on the branch being merged into. */
async function checkPolicy(root: string, base?: string, push = process.env.GITHUB_EVENT_NAME === "push"): Promise<IntegrityFinding[]> {
  const ref = base ?? process.env.ATDD_BASE_REF ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/HEAD");
  if ((await git(root, ["rev-parse", "--verify", "--quiet", ref])).code) return [];
  let against = (await git(root, ["merge-base", "HEAD", ref])).out;
  // A CI push to the base branch has nothing to merge into: judge the pushed commit against its parent.
  if (push && against === (await git(root, ["rev-parse", "HEAD"])).out) against = (await git(root, ["rev-parse", "--verify", "--quiet", "HEAD~1"])).out;
  if (!against) return [];
  const read = async (text: string | null) => (text ? Bun.YAML.parse(text) ?? {} : {}) as Partial<HookPolicy>;
  const before = await git(root, ["show", `${against}:atdd-bun.yaml`]), path = join(root, "atdd-bun.yaml");
  const loosened = loosenedPolicy(await read(before.code ? null : before.out), await read(existsSync(path) ? await readFile(path, "utf8") : null));
  return loosened.length ? [{ file: "atdd-bun.yaml", detail: `loosens the policy of ${against.slice(0, 7)}: ${loosened.join("; ")}`, restore: `git checkout ${against.slice(0, 7)} -- atdd-bun.yaml` }] : [];
}

export async function checkIntegrity(options: IntegrityOptions = {}): Promise<IntegrityFinding[]> {
  const root = resolve(options.root ?? process.cwd()), packageRoot = options.packageRoot ?? ownRoot;
  return [...await checkInstalledPackage(packageRoot), ...await checkDependency(root), ...await checkGenerated(root, packageRoot), ...await checkPolicy(root, options.base, options.push)];
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
