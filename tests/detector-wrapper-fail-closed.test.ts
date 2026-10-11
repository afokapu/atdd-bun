import { expect, test } from "bun:test";
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// A family wrapper (detectors/*/detect.mjs) runs member checks and merges their reports. A member that cannot run
// (crash, non-zero exit, no report, unparseable report) must fail the WRAPPER, never read as "zero findings":
// in a ratchet that asymmetry makes a candidate-only crash look like resolved debt and masks genuinely new findings.
const root = resolve(import.meta.dir, "..");
const detectors = join(root, "detectors");
const cli = join(root, "src/cli.ts");
const bun = Bun.which("bun") ?? globalThis.process.execPath;

const AFFECTED = [
  "bun_clean_architecture_detector", "bun_design_system_detector", "bun_fullstack_detector", "bun_green_traceability_detector",
  "bun_interlocking_coverage", "bun_interlocking_infrastructure", "bun_responsive_detector", "bun_security_hygiene_detector",
  "bun_telemetry_code", "bun_telemetry_test", "bun_tester_discipline_detector", "bun_ts_metrics_detector",
  "htmx_e2e_detector", "htmx_hypermedia_detector", "htmx_tester_detector",
];

test("the affected wrapper inventory is exactly every detector that spawns member checks", () => {
  const spawning = readdirSync(detectors).filter(name => existsSync(join(detectors, name, "detect.mjs")) && readFileSync(join(detectors, name, "detect.mjs"), "utf8").includes("execFileSync")).sort();
  expect(spawning).toEqual([...AFFECTED].sort());
});

const MEMBERS = {
  clean: `import { writeFileSync } from "node:fs"; writeFileSync(process.env.ATDD_VIOLATIONS_REPORT, JSON.stringify({ violations: [] }));\n`,
  finding: `import { writeFileSync } from "node:fs"; writeFileSync(process.env.ATDD_VIOLATIONS_REPORT, JSON.stringify({ violations: [{ rule_id: "x.y", file: "a.ts", line: 1, col: 0, evidence: "e", source_line: "s" }] }));\n`,
  crash: `throw new Error("member cannot run");\n`,
  nonZeroAfterReport: `import { writeFileSync } from "node:fs"; writeFileSync(process.env.ATDD_VIOLATIONS_REPORT, JSON.stringify({ violations: [] })); process.exit(1);\n`,
  noReport: `process.exit(0);\n`,
  garbageReport: `import { writeFileSync } from "node:fs"; writeFileSync(process.env.ATDD_VIOLATIONS_REPORT, "{not json");\n`,
  wrongShapeReport: `import { writeFileSync } from "node:fs"; writeFileSync(process.env.ATDD_VIOLATIONS_REPORT, JSON.stringify({ findings: [] }));\n`,
};

async function runWrapper(family: string, members: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "atdd-wrapper-"));
  try {
    await mkdir(join(dir, "checks"));
    copyFileSync(join(detectors, family, "detect.mjs"), join(dir, "detect.mjs"));
    for (const [name, source] of Object.entries(members)) await writeFile(join(dir, "checks", `${name}.mjs`), source);
    const report = join(dir, "report.json");
    const child = Bun.spawn({ cmd: [bun, join(dir, "detect.mjs")], cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, ATDD_VIOLATIONS_REPORT: report } });
    const exitCode = await child.exited;
    return { exitCode, stderr: await new Response(child.stderr).text(), report: existsSync(report) ? readFileSync(report, "utf8") : null };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

for (const family of AFFECTED) {
  test(`${family}: clean and finding members still report normally`, async () => {
    const clean = await runWrapper(family, { a_clean: MEMBERS.clean });
    expect(clean.exitCode).toBe(0);
    expect(JSON.parse(clean.report!)).toEqual({ violations: [] });
    const found = await runWrapper(family, { a_clean: MEMBERS.clean, b_finding: MEMBERS.finding });
    expect(found.exitCode).toBe(0);
    expect(JSON.parse(found.report!).violations).toHaveLength(1);
  });

  for (const [label, source] of [["crashes", MEMBERS.crash], ["exits non-zero even after writing a report", MEMBERS.nonZeroAfterReport], ["exits cleanly without a report", MEMBERS.noReport], ["writes an unparseable report", MEMBERS.garbageReport], ["writes a report without a violations array", MEMBERS.wrongShapeReport]] as const) {
    test(`${family}: a member that ${label} fails the wrapper closed, even beside a healthy member`, async () => {
      const result = await runWrapper(family, { a_clean: MEMBERS.clean, b_bad: source });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("b_bad");
    });
  }
}

// Ratchet level. A dangling symlink under plan/_journeys makes the real journey_station_routing member throw
// (statSync ENOENT) in the candidate only. The wrapper used to swallow it: the member's base findings vanished.
const git = async (cwd: string, ...args: string[]) => {
  const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(child.stdout).text();
  await child.exited;
  return out.trim();
};
const ratchet = async (repo: string, base: string) => {
  const child = Bun.spawn({ cmd: [bun, cli, "interlocking", "--root", repo, "--ratchet", "--base", base], cwd: root, stdout: "pipe", stderr: "pipe" });
  return { exitCode: await child.exited, stdout: await new Response(child.stdout).text(), stderr: await new Response(child.stderr).text() };
};
const scaffold = async (journeys: boolean) => {
  const repo = await mkdtemp(join(tmpdir(), "atdd-wrapper-ratchet-"));
  await git(repo, "init", "-q", "-b", "main"); await git(repo, "config", "user.email", "ratchet@test"); await git(repo, "config", "user.name", "Ratchet");
  await writeFile(join(repo, "atdd-bun.yaml"), "profiles: [interlocking]\nratchet: { mode: reject-new, profiles: [interlocking] }\n");
  await mkdir(join(repo, "plan", "_journeys"), { recursive: true });
  await writeFile(join(repo, "server.ts"), "export const x = 1;\n");
  return { repo, addJourney: () => writeFile(join(repo, "plan", "_journeys", "j.yaml"), "journey_id: journey:a\nentrypoint:\n  exposed: true\n  actions: [go]\n"), addDanglingLink: () => symlink("missing.yaml", join(repo, "plan", "_journeys", "dangling.yaml")), journeys };
};

test("control: an exposed journey with no Station Master routing is a carried finding when nothing crashes", async () => {
  const { repo, addJourney } = await scaffold(true);
  try {
    await addJourney(); await git(repo, "add", "."); await git(repo, "commit", "-qm", "base debt");
    const base = await git(repo, "rev-parse", "HEAD");
    await writeFile(join(repo, "unrelated.md"), "candidate\n"); await git(repo, "add", "."); await git(repo, "commit", "-qm", "candidate");
    const result = await ratchet(repo, base);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.carried.length).toBeGreaterThan(0);
    expect(report.new).toEqual([]); expect(report.resolved).toEqual([]);
  } finally { await rm(repo, { recursive: true, force: true }); }
}, 30_000);

test("a candidate-only member crash is a run failure, not phantom resolved findings", async () => {
  const { repo, addJourney, addDanglingLink } = await scaffold(true);
  try {
    await addJourney(); await git(repo, "add", "."); await git(repo, "commit", "-qm", "base debt");
    const base = await git(repo, "rev-parse", "HEAD");
    await addDanglingLink(); await git(repo, "add", "."); await git(repo, "commit", "-qm", "candidate adds a dangling link");
    const result = await ratchet(repo, base);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("atdd-bun.ratchet-report/v1");
    expect(result.stderr).toContain("bun_interlocking_infrastructure");
  } finally { await rm(repo, { recursive: true, force: true }); }
}, 30_000);

test("a candidate-only member crash cannot mask a genuinely new finding", async () => {
  const { repo, addJourney, addDanglingLink } = await scaffold(false);
  try {
    await git(repo, "add", "."); await git(repo, "commit", "-qm", "base is clean");
    const base = await git(repo, "rev-parse", "HEAD");
    await addJourney(); await addDanglingLink(); await git(repo, "add", "."); await git(repo, "commit", "-qm", "candidate adds a violation and hides it behind a crash");
    const result = await ratchet(repo, base);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("atdd-bun.ratchet-report/v1");
  } finally { await rm(repo, { recursive: true, force: true }); }
}, 30_000);
