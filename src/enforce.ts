import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { topologyFor } from "./topology";

export type Profile = "traceability" | "topology" | "docs" | "planner" | "telemetry" | "coder" | "tester" | "security" | "architecture" | "metrics" | "runtime" | "interlocking" | "htmx" | "design" | "flow" | "all";
export type ConcreteProfile = Exclude<Profile, "all">;

export type Violation = {
  rule_id: string;
  file: string;
  line: number;
  col: number;
  evidence: string;
  source_line: string;
};

export type EnforcementConfig = {
  root?: string;
  scanRoots?: string[];
  excludes?: string[];
  profiles?: Profile[];
};

export const profileImplementations: Record<ConcreteProfile, string[]> = {
  traceability: ["atdd_traceability_closure"],
  topology: ["atdd_topology"],
  docs: ["planner_docs_capability"],
  planner: ["planner_plan_integrity", "planner_schema_validation", "planner_static_validators", "atdd_topology"],
  telemetry: ["planner_telemetry_plan", "bun_telemetry_code", "bun_telemetry_test"],
  coder: ["bun_green_traceability_detector", "bun_clean_architecture_detector", "bun_ts_metrics_detector", "bun_fullstack_detector", "bun_design_system_detector", "bun_responsive_detector", "atdd_topology"],
  tester: ["bun_tester_discipline_detector", "htmx_e2e_detector", "atdd_topology"],
  security: ["bun_security_hygiene_detector"],
  architecture: ["bun_clean_architecture_detector"],
  metrics: ["bun_ts_metrics_detector"],
  runtime: ["bun_fullstack_detector"],
  interlocking: ["bun_interlocking_binding", "bun_interlocking_coverage", "bun_interlocking_infrastructure"],
  htmx: ["htmx_hypermedia_detector", "htmx_tester_detector", "htmx_e2e_detector"],
  design: ["bun_design_system_detector", "bun_responsive_detector"],
  // Operational policies only: the Flow companion supplies lifecycle orchestration; ATDD Bun supplies delivery review semantics.
  flow: [],
};

/** Additional policy conventions a profile loads, whether local or contributed by an installed companion package. */
export const profileConventions: Record<ConcreteProfile, Array<{ rule_id: string; path: string }>> = {
  traceability: [], topology: [], docs: [], planner: [], telemetry: [], coder: [{ rule_id: "coder.bun.phase-discipline", path: "conventions/coder.bun/coder.bun.phase-discipline.convention.yaml" }], tester: [], security: [],
  architecture: [], metrics: [], runtime: [], interlocking: [], htmx: [], design: [],
  flow: [
    { rule_id: "atdd-bun.review.behavioral-reconciliation", path: "conventions/atdd-bun.review/atdd-bun.review.behavioral-reconciliation.convention.yaml" },
    { rule_id: "atdd-workflow.workflow.lifecycle", path: "../atdd-flow/conventions/atdd-workflow.workflow/atdd-workflow.workflow.lifecycle.convention.yaml" },
  ],
};

/** Every profile but `all`. */
export const concreteProfiles = Object.keys(profileImplementations) as ConcreteProfile[];
/** Profiles a repository adopts only when it explicitly uses the optional companion package. */
export const optionalProfiles: ConcreteProfile[] = ["flow"];
/** The safe default set for repositories that have not opted into an optional companion profile. */
export const defaultProfiles = concreteProfiles.filter(profile => !optionalProfiles.includes(profile));
/** Profile names accepted by the CLI and public integrations. */
export const profileNames = [...concreteProfiles, "all"] as Profile[];
/** Retired spellings accepted only to migrate old configuration and invocations to their canonical profile. */
export const legacyProfileAliases = { workflow: "flow" } as const;

/** Normalize a supported retired spelling without making it part of the canonical profile registry. */
export function normalizeProfileName(name: string): string {
  return legacyProfileAliases[name as keyof typeof legacyProfileAliases] ?? name;
}

/** Guidance for a repository that was configured during the workflow → flow rename. */
export const flowCompatibilityDiagnostic = "Legacy profile workflow is normalized to canonical flow. If this checkout reports flow as unknown, it is using @afokapu/atdd-bun older than 0.10.45; run bun update @afokapu/atdd-bun, then invoke the project-local CLI with bun run atdd-bun flow --root . (not a PATH-global atdd-bun).";

/**
 * The profiles the operator has activated: `profiles:` in atdd-bun.yaml, or every built-in profile when absent. A legacy
 * repository can adopt enforcement gradually by listing only what it is ready for. `all`, the hooks and the
 * generated CI run exactly these; naming a profile explicitly still runs it. An unknown name or an empty list is
 * a configuration error, never a silent "run nothing".
 */
export async function enabledProfiles(root = process.cwd()): Promise<ConcreteProfile[]> {
  const file = join(resolve(root), "atdd-bun.yaml");
  const listed = existsSync(file) ? (Bun.YAML.parse(await readFile(file, "utf8")) as { profiles?: unknown } | null)?.profiles : undefined;
  if (listed === undefined) return defaultProfiles;
  if (!Array.isArray(listed) || !listed.length) throw new Error("atdd-bun.yaml profiles must be a non-empty list of profile names");
  const normalized = listed.map(name => typeof name === "string" ? normalizeProfileName(name) : name);
  const unknown = normalized.filter(name => typeof name !== "string" || !concreteProfiles.includes(name as ConcreteProfile));
  if (unknown.length) throw new Error(`atdd-bun.yaml profiles lists unknown profile(s): ${unknown.join(", ")}; known: ${concreteProfiles.join(", ")}`);
  return [...new Set(normalized as ConcreteProfile[])];
}

const packageRoot = resolve(import.meta.dir, "..");
const detectorRoot = join(packageRoot, "detectors");

export function implementationsFor(requested: Profile[] = ["all"]): string[] {
  const selected = new Set<string>();
  for (const profile of requested) {
    if (profile === "all") {
      for (const ids of Object.values(profileImplementations)) ids.forEach((id) => selected.add(id));
      continue;
    }
    const ids = profileImplementations[profile];
    if (!ids) throw new Error(`unknown enforcement profile: ${profile}`);
    ids.forEach((id) => selected.add(id));
  }
  return [...selected].sort();
}

/** The rule ids a detector's manifest declares it emits (emits_rule_ids and api_emits_rule_ids). */
export async function declaredRuleIds(implementation: string, detectors = detectorRoot): Promise<Set<string>> {
  const ids = new Set<string>();
  let inList = false;
  for (const line of (await readFile(join(detectors, implementation, "atdd.implementation.yaml"), "utf8")).split("\n")) {
    if (line === "emits_rule_ids:" || line === "api_emits_rule_ids:") { inList = true; continue; }
    if (/^[A-Za-z_][\w-]*:/.test(line)) { inList = false; continue; }
    const match = inList && line.match(/^\s*-\s+([^#\s]+)/);
    if (match) ids.add(match[1]);
  }
  return ids;
}

/** Rule ids a detector actually emitted without declaring them. Checked at run time, so an id built at run
 * time (a template string, a concatenation, a value read from YAML) cannot escape the per-rule checks. */
export async function undeclaredEmissions(implementation: string, violations: Pick<Violation, "rule_id">[]): Promise<string[]> {
  const declared = await declaredRuleIds(implementation);
  return [...new Set(violations.map(v => v.rule_id).filter(id => !declared.has(id)))].sort();
}

// Detector concurrency is resource control, never verification: it changes when detectors run, not what they find.

/** A positive integer from the environment, else `fallback`. Any other value fails closed. */
function detectorLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  return Number(raw);
}

/** How many detectors one run may have in flight. */
const runDetectorLimit = () => detectorLimit("ATDD_BUN_MAX_DETECTORS", Math.max(2, Math.floor(availableParallelism() / 2)));
/** How many detectors all atdd-bun runs on this host may have in flight together. */
const hostDetectorLimit = () => detectorLimit("ATDD_BUN_HOST_DETECTORS", availableParallelism());
const slotDirectory = () => process.env.ATDD_BUN_DETECTOR_SLOTS_DIR ?? join(tmpdir(), "atdd-bun-detector-slots");

/** Map `work` over `items` with at most `limit` in flight; results keep the order of `items`. */
async function pooled<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const index = next++; results[index] = await work(items[index]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return errorCode(error) === "EPERM"; } };
const ownerPid = async (path: string) => Number((await readFile(path, "utf8").catch(() => "")).split(" ")[0]) || undefined;

/** Hard-link the fully written claim to the slot path: atomic and exclusive, like O_EXCL, so a reader never sees a half-written owner. */
async function claim(staging: string, slot: string): Promise<boolean> {
  try { await link(staging, slot); return true; } catch (error) { if (errorCode(error) === "EEXIST") return false; throw error; }
}

/** Free a slot whose owner process is gone. Moving it aside first means two reclaimers cannot both delete it; a slot
 * re-claimed by a live process in the meantime is put back. */
async function reclaimIfDead(slot: string, token: string): Promise<void> {
  const owner = await ownerPid(slot);
  if (owner === undefined || alive(owner)) return;
  const aside = `${slot}.reclaim-${token.replace(" ", "-")}`;
  try { await rename(slot, aside); } catch { return; }
  const moved = await ownerPid(aside);
  if (moved !== undefined && alive(moved)) await link(aside, slot).catch(() => undefined);
  await rm(aside, { force: true });
}

const warned = new Set<string>();
function warnUnusable(directory: string, error: unknown): void {
  if (warned.has(directory)) return;
  warned.add(directory);
  process.stderr.write(`atdd-bun: detector slot directory ${directory} is unusable (${(error as Error).message}); bounding detectors by the per-run cap only\n`);
}

/** Take one of the host-wide detector slots, waiting with a small backoff while all are held. Returns the release.
 * A slot directory that cannot be used at all degrades to the per-run cap, reported on stderr. */
async function acquireHostSlot(): Promise<() => Promise<void>> {
  const limit = hostDetectorLimit(), directory = slotDirectory();
  const token = `${process.pid} ${crypto.randomUUID()}`, staging = join(directory, `.claim-${token.replace(" ", "-")}`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(staging, token);
    for (let delay = 5; ; delay = Math.min(delay * 2, 200)) {
      for (let index = 0; index < limit; index++) {
        const slot = join(directory, `slot-${index}`);
        if (await claim(staging, slot)) return () => release(slot, token);
        await reclaimIfDead(slot, token);
        if (await claim(staging, slot)) return () => release(slot, token);
      }
      await Bun.sleep(delay);
    }
  } catch (error) {
    warnUnusable(directory, error);
    return async () => undefined;
  } finally {
    await rm(staging, { force: true }).catch(() => undefined);
  }
}

/** Release only a slot this claim still owns. */
async function release(slot: string, token: string): Promise<void> {
  if (await readFile(slot, "utf8").catch(() => "") === token) await rm(slot, { force: true });
}

/** Run `work` while holding one host-wide detector slot. */
async function withHostSlot<T>(work: () => Promise<T>): Promise<T> {
  const release = await acquireHostSlot();
  try { return await work(); } finally { await release(); }
}

export async function runImplementation(
  implementation: string,
  config: Required<Pick<EnforcementConfig, "scanRoots" | "excludes">> & { profiles?: ConcreteProfile[] },
): Promise<Violation[]> {
  const detector = join(detectorRoot, implementation, "detect.mjs");
  const scratch = await mkdtemp(join(tmpdir(), "atdd-bun-"));
  const report = join(scratch, "violations.json");
  try {
    const bun = Bun.which("bun") ?? process.execPath, topology = await topologyFor(config.scanRoots[0] ?? process.cwd());
    // One host-wide slot per detector process, so concurrent runs cannot together exhaust the machine.
    const { exitCode, child } = await withHostSlot(async () => {
      const child = Bun.spawn({
        cmd: [bun, detector],
        cwd: config.scanRoots[0] ?? process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          ATDD_SCAN_ROOTS: JSON.stringify(config.scanRoots),
          ATDD_SCAN_EXCLUDES: JSON.stringify(config.excludes),
          ATDD_PLAN_ROOT: topology.planRoot,
          ATDD_VIOLATIONS_REPORT: report,
          // The profiles this run selected, so a detector shared by several profiles can tell a planning run from
          // one that has reached RED or GREEN. Absent on a direct call, where detectors keep their full behaviour.
          ...(config.profiles ? { ATDD_PROFILES: JSON.stringify(config.profiles) } : {}),
        },
      });
      return { exitCode: await child.exited, child };
    });
    if (exitCode !== 0) {
      const stderr = await new Response(child.stderr).text();
      throw new Error(`${implementation} failed to run (exit ${exitCode}): ${stderr.trim()}`);
    }
    const raw = JSON.parse(await readFile(report, "utf8"));
    if (!raw || !Array.isArray(raw.violations)) {
      throw new Error(`${implementation} emitted no structured violation report`);
    }
    const undeclared = await undeclaredEmissions(implementation, raw.violations as Violation[]);
    if (undeclared.length) throw new Error(`${implementation} emitted rule id(s) its manifest does not declare: ${undeclared.join(", ")}. Declare them in emits_rule_ids, each with a convention.`);
    return raw.violations as Violation[];
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function enforce(config: EnforcementConfig = {}): Promise<Violation[]> {
  const root = resolve(config.root ?? process.cwd());
  const scanRoots = (config.scanRoots?.length ? config.scanRoots : [root]).map((path) => resolve(root, path));
  const excludes = ["node_modules", ".git", ".atdd", ...(config.excludes ?? [])];
  // `all` means every profile the operator activated; explicitly named profiles run as asked. The operator's list
  // is validated on every run, so a misspelled atdd-bun.yaml fails whichever profile is requested.
  const requested = config.profiles ?? ["all"], enabled = await enabledProfiles(root);
  const selected = requested.includes("all") ? [...new Set([...requested.filter(p => p !== "all"), ...enabled])] : requested;
  const results = await pooled(implementationsFor(selected), runDetectorLimit(),
    (implementation) => runImplementation(implementation, { scanRoots, excludes, profiles: selected as ConcreteProfile[] }),
  );
  return results.flat().sort((left, right) =>
    left.rule_id.localeCompare(right.rule_id) || left.file.localeCompare(right.file) || left.line - right.line,
  );
}
