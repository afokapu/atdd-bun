import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

/** Profile names accepted by the CLI and public integrations. */
export const profileNames = [...Object.keys(profiles), "all"] as Profile[];

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

export async function runImplementation(
  implementation: string,
  config: Required<Pick<EnforcementConfig, "scanRoots" | "excludes">>,
): Promise<Violation[]> {
  const detector = join(detectorRoot, implementation, "detect.mjs");
  const scratch = await mkdtemp(join(tmpdir(), "atdd-bun-"));
  const report = join(scratch, "violations.json");
  try {
    const bun = Bun.which("bun") ?? process.execPath;
    const child = Bun.spawn({
      cmd: [bun, detector],
      cwd: config.scanRoots[0] ?? process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ATDD_SCAN_ROOTS: JSON.stringify(config.scanRoots),
        ATDD_SCAN_EXCLUDES: JSON.stringify(config.excludes),
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
    return raw.violations as Violation[];
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function enforce(config: EnforcementConfig = {}): Promise<Violation[]> {
  const root = resolve(config.root ?? process.cwd());
  const scanRoots = (config.scanRoots?.length ? config.scanRoots : [root]).map((path) => resolve(root, path));
  const excludes = ["node_modules", ".git", ".atdd", ...(config.excludes ?? [])];
  const results = await Promise.all(
    implementationsFor(config.profiles).map((implementation) => runImplementation(implementation, { scanRoots, excludes })),
  );
  return results.flat().sort((left, right) =>
    left.rule_id.localeCompare(right.rule_id) || left.file.localeCompare(right.file) || left.line - right.line,
  );
}
