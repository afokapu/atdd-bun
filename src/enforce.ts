import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { topologyFor } from "./topology";

export type Profile = "traceability" | "topology" | "docs" | "planner" | "coder" | "tester" | "security" | "architecture" | "metrics" | "runtime" | "interlocking" | "htmx" | "design" | "all";

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

const profiles: Record<Exclude<Profile, "all">, string[]> = {
  traceability: ["atdd_traceability_closure"],
  topology: ["atdd_topology"],
  docs: ["planner_docs_capability"],
  planner: ["planner_plan_integrity", "planner_schema_validation", "planner_static_validators", "atdd_topology"],
  coder: ["bun_green_traceability_detector", "bun_clean_architecture_detector", "bun_ts_metrics_detector", "bun_fullstack_detector", "bun_design_system_detector", "bun_responsive_detector", "atdd_topology"],
  tester: ["bun_tester_discipline_detector", "htmx_e2e_detector", "atdd_topology"],
  security: ["bun_security_hygiene_detector"],
  architecture: ["bun_clean_architecture_detector"],
  metrics: ["bun_ts_metrics_detector"],
  runtime: ["bun_fullstack_detector"],
  interlocking: ["bun_interlocking_binding", "bun_interlocking_coverage", "bun_interlocking_infrastructure"],
  htmx: ["htmx_hypermedia_detector", "htmx_tester_detector", "htmx_e2e_detector"],
  design: ["bun_design_system_detector", "bun_responsive_detector"],
};

type ConcreteProfile = Exclude<Profile, "all">;
/** Every profile but `all`. */
export const concreteProfiles = Object.keys(profiles) as ConcreteProfile[];
/** Profile names accepted by the CLI and public integrations. */
export const profileNames = [...concreteProfiles, "all"] as Profile[];

/**
 * The profiles the operator has activated: `profiles:` in atdd-bun.yaml, or every profile when absent. A legacy
 * repository can adopt enforcement gradually by listing only what it is ready for. `all`, the hooks and the
 * generated CI run exactly these; naming a profile explicitly still runs it. An unknown name or an empty list is
 * a configuration error, never a silent "run nothing".
 */
export async function enabledProfiles(root = process.cwd()): Promise<ConcreteProfile[]> {
  const file = join(resolve(root), "atdd-bun.yaml");
  const listed = existsSync(file) ? (Bun.YAML.parse(await readFile(file, "utf8")) as { profiles?: unknown } | null)?.profiles : undefined;
  if (listed === undefined) return concreteProfiles;
  if (!Array.isArray(listed) || !listed.length) throw new Error("atdd-bun.yaml profiles must be a non-empty list of profile names");
  const unknown = listed.filter(name => !concreteProfiles.includes(name));
  if (unknown.length) throw new Error(`atdd-bun.yaml profiles lists unknown profile(s): ${unknown.join(", ")}; known: ${concreteProfiles.join(", ")}`);
  return [...new Set(listed as ConcreteProfile[])];
}

const packageRoot = resolve(import.meta.dir, "..");
const detectorRoot = join(packageRoot, "detectors");

export function implementationsFor(requested: Profile[] = ["all"]): string[] {
  const selected = new Set<string>();
  for (const profile of requested) {
    if (profile === "all") {
      for (const ids of Object.values(profiles)) ids.forEach((id) => selected.add(id));
      continue;
    }
    const ids = profiles[profile];
    if (!ids) throw new Error(`unknown enforcement profile: ${profile}`);
    ids.forEach((id) => selected.add(id));
  }
  return [...selected].sort();
}

/** The rule ids a detector's manifest declares it emits (emits_rule_ids and api_emits_rule_ids). */
export async function declaredRuleIds(implementation: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let inList = false;
  for (const line of (await readFile(join(detectorRoot, implementation, "atdd.implementation.yaml"), "utf8")).split("\n")) {
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

export async function runImplementation(
  implementation: string,
  config: Required<Pick<EnforcementConfig, "scanRoots" | "excludes">>,
): Promise<Violation[]> {
  const detector = join(detectorRoot, implementation, "detect.mjs");
  const scratch = await mkdtemp(join(tmpdir(), "atdd-bun-"));
  const report = join(scratch, "violations.json");
  try {
    const bun = Bun.which("bun") ?? process.execPath, topology = await topologyFor(config.scanRoots[0] ?? process.cwd());
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
      },
    });
    const exitCode = await child.exited;
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
  const results = await Promise.all(
    implementationsFor(selected).map((implementation) => runImplementation(implementation, { scanRoots, excludes })),
  );
  return results.flat().sort((left, right) =>
    left.rule_id.localeCompare(right.rule_id) || left.file.localeCompare(right.file) || left.line - right.line,
  );
}
