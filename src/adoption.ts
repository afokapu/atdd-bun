import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { enforce, type Profile, type Violation } from "./enforce";
import { lifecycleOf } from "./lifecycle";
import { loadPlan } from "./planner-kernel";

/**
 * ADOPTION. `atdd-bun all` is always the full, strict audit of the whole repository. The GATE is what hooks
 * and CI block on, and how much of the audit it blocks on depends on how the repository adopted atdd-bun:
 *
 *   greenfield (default)  the gate is the full audit: every finding blocks.
 *   brownfield            the gate blocks on the CHANGED SLICE: findings in a file the change touches, or
 *                         naming a plan/test/component identity its changed lines touch. Findings elsewhere
 *                         are legacy debt: counted and reported on every run, never silently dropped, and
 *                         still failing `atdd-bun all`.
 *
 * The slice is computed from Git (base..HEAD plus the working tree, the staged diff, or a pushed range) and
 * includes removed lines, so deleting a test pulls the acceptance it bound back into scope. When the base
 * cannot be resolved the gate falls back to the full audit: it never guesses a smaller scope. Moving from
 * greenfield to brownfield loosens the policy, so the integrity check reports it until a human approves it.
 */
export type AdoptionMode = "greenfield" | "brownfield";
export type Adoption = { mode: AdoptionMode; base: string };
export const defaultAdoption: Adoption = { mode: "greenfield", base: "origin/HEAD" };

/** A base that moves with the change itself (HEAD, @, FETCH_HEAD, …) would measure a change against itself
 * and leave an empty slice, so it is never a valid base. */
export const selfRelativeRef = (ref: string) => /^(?:@|(?:[A-Z_]*_)?HEAD)(?:$|[~^@{])/.test(ref.trim());

/** The adoption declared in atdd-bun.yaml. An unknown mode, or a brownfield base that is relative to the
 * change itself, is read as greenfield: the strict reading. */
export function adoptionOf(config: unknown): Adoption {
  const value = config && typeof config === "object" ? (config as { adoption?: unknown }).adoption : undefined;
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const base = typeof record.base === "string" && record.base ? record.base : defaultAdoption.base;
  return { mode: record.mode === "brownfield" && !selfRelativeRef(base) ? "brownfield" : "greenfield", base };
}

export async function adoptionPolicy(root: string): Promise<Adoption> {
  const file = join(root, "atdd-bun.yaml");
  return existsSync(file) ? adoptionOf(Bun.YAML.parse(await readFile(file, "utf8"))) : defaultAdoption;
}

const git = async (root: string, args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); return { code: await child.exited, out: (await new Response(child.stdout).text()).trim() }; };

/** The commit a change is measured against: the merge base with `ref` (or, in CI, the PR's base branch). A
 * push to the base branch itself has nothing to merge into, so it is judged against its parent. */
export async function baseCommit(root: string, ref?: string, push = process.env.GITHUB_EVENT_NAME === "push"): Promise<string | null> {
  const target = ref ?? process.env.ATDD_BASE_REF ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : defaultAdoption.base);
  if (selfRelativeRef(target) || (await git(root, ["rev-parse", "--verify", "--quiet", `${target}^{commit}`])).code) return null;
  let against = (await git(root, ["merge-base", "HEAD", target])).out;
  if (push && against && against === (await git(root, ["rev-parse", "HEAD"])).out) against = (await git(root, ["rev-parse", "--verify", "--quiet", "HEAD~1"])).out;
  return against || null;
}

/** What a change touches: its files, and the identities named on the lines it adds or removes. */
export type Slice = { files: Set<string>; identities: Set<string> };

const IDENTITY = /\b(?:wagon|feature|wmbt|acc|train|interlocking|journey|contract|component|test):[A-Za-z0-9_-]+(?:[:.][A-Za-z0-9_-]+)*/g;
const tokens = (text: string) => [...text.matchAll(IDENTITY)].map(match => match[0]);

/** Identities a changed line touches, widened to the feature and WMBT they belong to: changing one component,
 * test or acceptance brings that feature's (and WMBT's) own obligations into the slice. */
export function touchedIdentities(text: string): string[] {
  return tokens(text).flatMap(id => {
    const parts = id.split(":"), out = [id];
    if ((parts[0] === "component" || parts[0] === "test") && parts.length >= 4 && parts[1] !== "train" && parts[1] !== "journey") out.push(`feature:${parts[1]}:${parts[2]}`);
    const wmbt = id.match(/^acc:([a-z0-9][a-z0-9-]*):([A-Z][0-9]{3})-/);
    if (wmbt) out.push(`wmbt:${wmbt[1]}:${wmbt[2]}`);
    return out;
  });
}

const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}` : JSON.stringify(value) ?? "null";
/** atdd-bun.yaml with the adoption block removed, canonically serialised; a missing or unparsable file is `{}`. */
const configScope = (text: string | null) => { let data: unknown = {}; try { data = text ? Bun.YAML.parse(text) ?? {} : {}; } catch { data = { unparsable: text }; } const { adoption: _, ...rest } = (data && typeof data === "object" ? data : {}) as Record<string, unknown>; return canonical(rest); };

/** Whether the change edits atdd-bun.yaml beyond its adoption block. Topology roots, registry paths or limits
 * re-scope every check, so a slice cannot be trusted and the full audit applies. */
async function configurationChanged(root: string, diff: string[]): Promise<boolean> {
  const at = async (rev: string) => { const shown = await git(root, ["show", `${rev}:atdd-bun.yaml`]); return shown.code ? null : shown.out; };
  const [before, after] = diff[0] === "--cached" ? [await at("HEAD"), await at("")] : diff.length >= 2 ? [await at(diff[0]), await at(diff[1])] : [await at(diff[0]), existsSync(join(root, "atdd-bun.yaml")) ? await readFile(join(root, "atdd-bun.yaml"), "utf8") : null];
  return configScope(before) !== configScope(after);
}

/** The slice of a `git diff` (e.g. [base] for base..working tree, ["--cached"] for the staged change,
 * [from, to] for a pushed range), plus untracked files when `untracked`. `null` when the change edits
 * atdd-bun.yaml beyond its adoption block: the slice is then unknown and the full audit applies. */
export async function sliceOf(root: string, diff: string[], untracked = false): Promise<Slice | null> {
  const files = new Set((await git(root, ["diff", "--name-only", "--no-renames", ...diff])).out.split("\n").filter(Boolean));
  if ((files.has("atdd-bun.yaml") || (untracked && !diff.includes("--cached"))) && await configurationChanged(root, diff)) return null;
  const changed = (await git(root, ["diff", "-U0", "--no-renames", "--no-color", ...diff])).out.split("\n").filter(line => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line));
  if (untracked) for (const path of (await git(root, ["ls-files", "--others", "--exclude-standard"])).out.split("\n").filter(Boolean)) {
    files.add(path);
    try { changed.push(await readFile(join(root, path), "utf8")); } catch { /* unreadable: the path alone is in the slice */ }
  }
  // A changed plan file changes what its artifacts declare even when the changed line names nothing (a
  // `status:` flip activates every acceptance the feature owns). So the slice also holds the identities a
  // changed plan file declares, and every feature, WMBT or train the change names brings the acceptances it
  // owns (and a feature, its WMBTs).
  const plan = await loadPlan(root), lifecycle = lifecycleOf(plan.artifacts);
  const named = new Set([...changed.flatMap(tokens), ...plan.artifacts.filter(a => files.has(a.file)).map(a => a.id)]);
  const owned = (id: string) => [...(lifecycle.features.find(f => f.urn === id)?.wmbts ?? []), ...lifecycle.acceptances.filter(a => a.wmbt === id || a.owners.includes(id)).map(a => a.acceptance)];
  return { files, identities: new Set([...changed.flatMap(touchedIdentities), ...named, ...[...named].flatMap(owned)]) };
}

const relativeFile = (root: string, file: string) => (isAbsolute(file) ? relative(root, file) : file).replaceAll("\\", "/");

/** A finding is in the slice when it is reported on a changed file or names an identity the change touches. */
export function inSlice(root: string, violation: Violation, slice: Slice): boolean {
  return slice.files.has(relativeFile(root, violation.file)) || tokens(`${violation.evidence} ${violation.source_line}`).some(id => slice.identities.has(id));
}

export type GateResult = { ok: boolean; mode: AdoptionMode; blocking: Violation[]; outside: number; message: string };

/** Split an audit into what blocks and what is legacy debt. `slice` null means the scope is unknown, so
 * everything blocks. */
export function partition(root: string, mode: AdoptionMode, findings: Violation[], slice: Slice | null): GateResult {
  const blocking = mode === "greenfield" || !slice ? findings : findings.filter(v => inSlice(root, v, slice)), outside = findings.length - blocking.length;
  const scope = mode === "greenfield" ? "greenfield: full audit" : slice ? `brownfield: changed slice of ${slice.files.size} file(s)` : "brownfield: slice unknown (no usable base, or atdd-bun.yaml changed beyond adoption), full audit";
  const debt = outside ? `; ${outside} legacy finding(s) outside the slice (atdd-bun all lists them)` : "";
  return { ok: blocking.length === 0, mode, blocking, outside, message: `atdd-bun gate (${scope}): ${blocking.length} blocking${debt}` };
}

/** The adoption-aware gate over the working tree: `all` for greenfield, the changed slice for brownfield. */
export async function gate(options: { root?: string; base?: string; profiles?: Profile[] } = {}): Promise<GateResult> {
  const root = resolve(options.root ?? process.cwd()), adoption = await adoptionPolicy(root);
  const findings = await enforce({ root, profiles: options.profiles ?? ["all"] });
  if (adoption.mode === "greenfield") return partition(root, "greenfield", findings, null);
  const against = await baseCommit(root, options.base ?? process.env.ATDD_BASE_REF ?? (process.env.GITHUB_BASE_REF ? undefined : adoption.base));
  return partition(root, "brownfield", findings, against ? await sliceOf(root, [against], true) : null);
}
