import { expect, test } from "bun:test";
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";

// The exact findings of the frontend detectors on their fixtures. The corpus test only asks that each
// rule fires somewhere; this pins WHICH file each defect is reported on, so a regression that loses one
// case (every case below was found by adversarial review) fails here by name.
const detectors = resolve(import.meta.dir, "../detectors");
const findings = async (detector: string, fixture: string) => {
  const root = join(detectors, detector, "fixtures", fixture);
  return (await runImplementation(detector, { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).map(v => `${v.rule_id.split(".").at(-1)} ${v.file.slice(root.length + 1)}`);
};
const unique = (list: string[]) => [...new Set(list)].sort();

test("browser-spec detector: clean fixture, including every former false positive, is silent", async () => {
  // renamed axe import, inline width array, a unit test mentioning a URN, CRLF, playwright.config, a fixture module
  expect(await findings("htmx_e2e_detector", "clean")).toEqual([]);
});

test("browser-spec detector: each dirty case is reported on its own file", async () => {
  expect(unique(await findings("htmx_e2e_detector", "dirty"))).toEqual([
    "a11y-harness e2e/buy.a11y.e2e.ts",
    "a11y-harness e2e/tautology.a11y.e2e.ts",
    "covered-train-is-routed e2e/unrouted.e2e.ts",
    "e2e-binds-declared-subject e2e/ghost.e2e.ts",
    "e2e-spec-naming e2e/misnamed.spec.ts",
    "exposed-journey-e2e-coverage plan/_journeys/browse.yaml",
    "exposed-journey-e2e-coverage plan/_journeys/buy.yaml",
    "journey-binding-header e2e/bad-id.e2e.ts",
    "journey-binding-header e2e/both.e2e.ts",
    "journey-binding-header e2e/no-binding.e2e.ts",
    "journey-binding-header e2e/two-trains.e2e.ts",
    "journey-layer-assembly e2e/no-layer.e2e.ts",
    "journey-layer-assembly e2e/wrong-layer.e2e.ts",
    "journey-no-acceptance-marker e2e/acceptance.e2e.ts",
    "journey-urn-format e2e/bad-urn.e2e.ts",
    "journey-urn-format e2e/no-urn.e2e.ts",
    "journey-urn-format e2e/wrong-urn.e2e.ts",
    "presentation-smoke-coverage src/wagons/billing/presentation/invoice.tsx",
    "responsive-harness e2e/buy.responsive.e2e.ts",
    "responsive-harness e2e/first-only.responsive.e2e.ts",
    "responsive-journey-coverage plan/_journeys/browse.yaml",
    "train-e2e-coverage plan/_trains/orders/uncovered.yaml",
    "visual-harness e2e/buy.visual.e2e.ts",
  ]);
});

test("browser-spec detector: one defect is reported once", async () => {
  const all = await findings("htmx_e2e_detector", "dirty");
  // a URN repeated in header and title is one defect; an invalid binding is not also a URN mismatch
  expect(all.filter(f => f === "journey-urn-format e2e/bad-urn.e2e.ts")).toHaveLength(1);
  expect(all.filter(f => f === "journey-urn-format e2e/wrong-urn.e2e.ts")).toHaveLength(1);
  expect(all.filter(f => f.endsWith("e2e/bad-id.e2e.ts"))).toEqual(["journey-binding-header e2e/bad-id.e2e.ts"]);
});

test("responsive detector: clean fixture, including every former false positive, is silent", async () => {
  // content={VIEWPORT}, a head built from a partial, range queries on declared breakpoints, rem within bounds
  expect(await findings("bun_responsive_detector", "clean")).toEqual([]);
});

test("responsive detector: each dirty case is reported on its own file", async () => {
  const all = await findings("bun_responsive_detector", "dirty");
  expect(unique(all)).toEqual([
    "responsive-breakpoints-declared src/app.css",
    "responsive-breakpoints-declared src/units.css",
    "responsive-no-fixed-width src/app.css",
    "responsive-no-fixed-width src/units.css",
    "responsive-no-fixed-width src/wide.tsx",
    "responsive-viewport-meta public/fixed-viewport.html",
    "responsive-viewport-meta public/no-meta.html",
    "responsive-viewport-meta public/no-zoom.html",
    "responsive-viewport-meta public/scale.html",
    "responsive-viewport-meta src/render.ts",
  ]);
  // both range-syntax forms, and a rem width, are caught
  expect(all.filter(f => f === "responsive-breakpoints-declared src/units.css")).toHaveLength(2);
});

test("browser-spec detector: a backend-only plan needs no browser spec", async () => {
  // Found in PR review: trains in which no person takes part, and journeys whose surfaces are [backend],
  // have no screen to drive. The journey-runaway plan is exactly that.
  const root = resolve(import.meta.dir, "fixtures/journey-runaway");
  expect(await runImplementation("htmx_e2e_detector", { scanRoots: [root], excludes: [] })).toEqual([]);
});

test("only a browser spec is a journey spec: a bun:test may bind acc:train:… with Acceptance: whatever its URN or Train: line", async () => {
  const { parseSpec, isJourneySpec } = await import("../detectors/htmx_e2e_detector/checks/_e2e.mjs");
  const bun = (header: string) => parseSpec("e2e/trains/t/declared-outcome.test.ts", `${header}\nimport { test } from "bun:test";\ntest("x", () => {});\n`);
  const trainAcceptance = bun("// URN: test:train:protocol:declared-outcome\n// Acceptance: acc:train:protocol:declared-outcome\n// Phase: SMOKE");
  const topologyJourney = bun("// URN: test:orders:place-order:E001-E2E-001\n// Acceptance: acc:orders:E001-E2E-001\n// Train: train:orders:checkout");
  expect(isJourneySpec(trainAcceptance)).toBeFalse();
  expect(isJourneySpec(topologyJourney)).toBeFalse();
  // Browser specs stay journey specs: a Playwright file bound by header, and any *.e2e.* file.
  const playwright = parseSpec("e2e/checkout.spec.ts", `// Train: train:orders:checkout\nimport { test } from "@playwright/test";\ntest("x", async () => {});\n`);
  expect(isJourneySpec(playwright)).toBeTrue();
  expect(isJourneySpec(parseSpec("e2e/any.e2e.ts", `import { test } from "bun:test";\n`))).toBeTrue();
});

test("the shipped docs-site stylesheet is clean under the design profile", async () => {
  // Consumers link templates/docs/site.css from the package instead of hand-rolling a theme, so it must hold itself to
  // the rules it saves them from: no hardcoded or off-grid values, only declared breakpoints.
  const root = await mkdtemp(join(tmpdir(), "atdd-site-css-"));
  try {
    await mkdir(join(root, "docs", "site"), { recursive: true });
    await copyFile(resolve(import.meta.dir, "../templates/docs/site.css"), join(root, "docs", "site", "site.css"));
    for (const detector of ["bun_design_system_detector", "bun_responsive_detector"])
      expect((await runImplementation(detector, { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).map(v => v.rule_id)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a train acceptance's full URN resolves when the plan states it", async () => {
  // acc:train:<subject>:<slug>:<name> has several colon segments; the plan scan once kept only the first, so a test
  // binding a declared train acceptance was reported as unresolved (C1/JEV, atdd-maintainer #BpwXdu5z6kn7).
  const root = await mkdtemp(join(tmpdir(), "atdd-train-acc-"));
  try {
    await mkdir(join(root, "plan", "_trains"), { recursive: true });
    await mkdir(join(root, "tests", "trains", "protocol"), { recursive: true });
    await writeFile(join(root, "plan", "_trains", "train:protocol:prove.yaml"), "train_id: train:protocol:prove\nacceptances:\n  - identity:\n      urn: acc:train:protocol:prove:declared-outcome\n");
    await writeFile(join(root, "tests", "trains", "protocol", "declared-outcome.test.ts"), "// URN: test:train:protocol:prove:declared-outcome\n// Acceptance: acc:train:protocol:prove:declared-outcome\n// Phase: SMOKE\nimport { expect, test } from \"bun:test\";\ntest(\"x\", () => expect(1).toBe(1));\n");
    const found = await runImplementation("bun_tester_discipline_detector", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] });
    expect(found.filter(v => v.rule_id === "tester.bun.acceptance-resolves-to-declared")).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the tester checks skip the integrity test atdd-bun generates, and only while it is exactly what was generated", async () => {
  // A consumer may not edit that file, so a tester rule on it could never be repaired (resolver-os, atdd-maintainer
  // #XoNpJXRL5i9y). Recognised by content: an edited copy is judged like any test.
  const root = await mkdtemp(join(tmpdir(), "atdd-integrity-test-"));
  try {
    const file = join(root, "atdd-bun.integrity.test.ts"), template = await Bun.file(resolve(import.meta.dir, "../templates/agents/atdd-bun.integrity.test.ts")).text();
    const judged = async () => (await runImplementation("bun_tester_discipline_detector", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).filter(v => v.file.endsWith("atdd-bun.integrity.test.ts"));
    await writeFile(file, template.replace("{{VERSION}}", "0.10.11"));
    expect(await judged()).toEqual([]);
    await writeFile(file, `${template.replace("{{VERSION}}", "0.10.11")}// an edit\n`);
    expect((await judged()).map(v => v.rule_id)).toContain("tester.bun.test-carries-urn-identity");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the Station Master is the module that declares JOURNEY_MAP, not a test that imports it", async () => {
  // With the Station Master at src/server.ts, a route test importing the map sorted first and was taken for it, so its
  // empty view of the map reported every correctly wired action (C1, atdd-maintainer #MjeoAs7SZUHk).
  const root = await mkdtemp(join(tmpdir(), "atdd-station-"));
  try {
    await cp(join(detectors, "bun_interlocking_binding", "fixtures", "clean"), root, { recursive: true });
    await rename(join(root, "server.ts"), join(root, "src", "server.ts"));
    await writeFile(join(root, "e2e", "interlockings", "aa-imports-map.test.ts"), 'import { JOURNEY_MAP } from "../../src/server";\nexport const actions = Object.keys(JOURNEY_MAP);\n');
    expect((await runImplementation("bun_interlocking_binding", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).map(v => `${v.rule_id} ${v.file.slice(root.length + 1)}`)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("TrainRunner cannot pass by returning a fabricated literal trace instead of executing its declared train", async () => {
  // RED mutant: InterlockingRunner honestly resolves its declaration, but the production
  // executor ignores the supplied train entirely. The binding check must reject this
  // independently of the resolver's correct route selection.
  const root = await mkdtemp(join(tmpdir(), "atdd-trainrunner-noop-"));
  try {
    await cp(join(detectors, "bun_interlocking_binding", "fixtures", "clean"), root, { recursive: true });
    await writeFile(join(root, "src", "trains", "runner.ts"), `
export class TrainRunner {
  constructor(private readonly trainId: string) {}
  execute(_inputs: Record<string, unknown>) {
    return { selectedTrainId: this.trainId, trace: ["load-match", "resolve-match"] };
  }
}
`);
    const found = await runImplementation("bun_interlocking_binding", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] });
    expect(found.some(v => v.rule_id === "coder.bun.runtime-executes-the-declaration" && v.file.endsWith("src/trains/runner.ts"))).toBeTrue();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("defining Bun.serve's fetch handler is not an outbound fetch call; a real call still is", async () => {
  // resolver-os #iFlkkL7jvEbC: `async fetch(request) {` was reported as a presentation-layer HTTP call.
  const root = await mkdtemp(join(tmpdir(), "atdd-fetch-handler-"));
  try {
    await mkdir(join(root, "features", "logs", "presentation"), { recursive: true });
    await writeFile(join(root, "features", "logs", "presentation", "index.ts"), 'export const server = Bun.serve({\n  port: 8090,\n  async fetch(request: Request): Promise<Response> {\n    return new Response("ok");\n  },\n});\nexport const ping = () => fetch("https://example.test/ping");\n');
    const found = (await runImplementation("bun_clean_architecture_detector", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).filter(v => v.rule_id === "coder.bun.boundaries-http-client");
    expect(found.map(v => v.line)).toEqual([7]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a checkout whose path contains an exclude word is still scanned: excludes match segments under the scan root", async () => {
  // FWS #U3vqdzo2RwFa: under ~/Github/frg-workstation-building-profile-activation, `build` matched `building` in the absolute
  // path and every file was excluded, so the profiles passed on nothing.
  const base = await mkdtemp(join(tmpdir(), "atdd-exclude-"));
  try {
    for (const detector of ["bun_clean_architecture_detector", "bun_tester_discipline_detector", "bun_interlocking_coverage"]) {
      const plain = join(base, "plain", detector), building = join(base, "frg-building-dist", detector);
      await cp(join(detectors, detector, "fixtures", "dirty"), plain, { recursive: true });
      await cp(join(detectors, detector, "fixtures", "dirty"), building, { recursive: true });
      const found = async (root: string) => (await runImplementation(detector, { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).map(v => `${v.rule_id} ${v.file.replace(root, "")}:${v.line}`).sort();
      const expected = await found(plain);
      expect(expected.length).toBeGreaterThan(0);
      expect(await found(building)).toEqual(expected);
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});

// A family wrapper (detectors/*/detect.mjs) runs member checks and merges their reports. A member that cannot run
// (crash, non-zero exit, no report, unparseable report) must fail the WRAPPER, never read as "zero findings":
// in a ratchet that asymmetry makes a candidate-only crash look like resolved debt and masks genuinely new findings.
const root = resolve(import.meta.dir, "..");
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

async function runWrapper(family: string, members: Record<string, string>, scratchTmp?: string) {
  const dir = await mkdtemp(join(tmpdir(), "atdd-wrapper-"));
  try {
    await mkdir(join(dir, "checks"));
    copyFileSync(join(detectors, family, "detect.mjs"), join(dir, "detect.mjs"));
    for (const [name, source] of Object.entries(members)) await writeFile(join(dir, "checks", `${name}.mjs`), source);
    const report = join(dir, "report.json");
    const child = Bun.spawn({ cmd: [bun, join(dir, "detect.mjs")], cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, ATDD_VIOLATIONS_REPORT: report, ...(scratchTmp ? { TMPDIR: scratchTmp } : {}) } });
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

  test(`${family}: a run, successful or failed, leaves no temp directory behind`, async () => {
    const scratch = await mkdtemp(join(tmpdir(), "atdd-wrapper-tmp-"));
    try {
      await runWrapper(family, { a_clean: MEMBERS.clean }, scratch);
      await runWrapper(family, { a_clean: MEMBERS.clean, b_bad: MEMBERS.crash }, scratch);
      expect(readdirSync(scratch)).toEqual([]);
    } finally { await rm(scratch, { recursive: true, force: true }); }
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

// coder.bun.duplication-intra-layer on type and interface member declarations. Once identifiers are folded,
// two unrelated record types with seven `readonly id: string;` members match line for line, and the
// consumer has no legal fix: coupling the records is wrong and cosmetic edits are forbidden. Property
// signatures inside a `type X = {` / `interface X {` body are therefore left out of the windows, as import
// declarations already are. Executable code, object literals and class fields with initializers keep counting.
const DUPLICATION_RULE = "coder.bun.duplication-intra-layer";
async function duplications(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "atdd-dup-type-members-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const violations = await runImplementation("bun_ts_metrics_detector", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] });
    return violations.filter((violation) => violation.rule_id === DUPLICATION_RULE);
  } finally { await rm(root, { recursive: true, force: true }); }
}

const fields = (names: string[], line: (name: string) => string) => names.map(line).join("\n");
const orderNames = ["orderId", "customerId", "storeId", "channelId", "currencyId", "regionId", "createdBy"];
const shipmentNames = ["shipmentId", "carrierId", "depotId", "routeId", "vehicleId", "driverId", "trackingCode"];

test("FRG: two unrelated readonly record types in one layer are not duplication", async () => {
  expect(await duplications({
    "orders/domain/order-record.ts": `export type OrderRecord = {\n${fields(orderNames, (n) => `  readonly ${n}: string;`)}\n};\n`,
    "shipping/domain/shipment-record.ts": `export type ShipmentRecord = {\n${fields(shipmentNames, (n) => `  readonly ${n}: string;`)}\n};\n`,
  })).toEqual([]);
});

test("interface bodies with optional and comma-terminated members are not duplication", async () => {
  expect(await duplications({
    "orders/domain/order-view.ts": `export interface OrderView {\n${fields(orderNames, (n) => `  ${n}?: string,`)}\n}\n`,
    "shipping/domain/shipment-view.ts": `export interface ShipmentView extends Base {\n${fields(shipmentNames, (n) => `  ${n}?: string,`)}\n}\n`,
  })).toEqual([]);
});

test("nested object-type members count as signatures too", async () => {
  const nested = (name: string, names: string[]) =>
    `export type ${name} = {\n  readonly id: string;\n  readonly meta: {\n${fields(names, (n) => `    readonly ${n}: string;`)}\n  };\n};\n`;
  expect(await duplications({
    "orders/domain/order-meta.ts": nested("OrderMeta", orderNames),
    "shipping/domain/shipment-meta.ts": nested("ShipmentMeta", shipmentNames),
  })).toEqual([]);
});

test("negative: seven duplicated statements still fire", async () => {
  const body = (names: string[]) => `export function run(input: any) {\n${fields(names, (n) => `  const ${n} = input.${n};`)}\n  return input;\n}\n`;
  expect((await duplications({
    "orders/domain/order-run.ts": body(orderNames),
    "shipping/domain/shipment-run.ts": body(shipmentNames),
  })).length).toBeGreaterThan(0);
});

test("negative: a duplicated object-literal run still fires", async () => {
  const literal = (name: string, names: string[]) => `export const ${name} = {\n${fields(names, (n) => `  ${n}: source,`)}\n};\n`;
  expect((await duplications({
    "orders/domain/order-defaults.ts": literal("orderDefaults", orderNames),
    "shipping/domain/shipment-defaults.ts": literal("shipmentDefaults", shipmentNames),
  })).length).toBeGreaterThan(0);
});

test("negative: a duplicated class-field-initializer run still fires", async () => {
  const klass = (name: string, names: string[]) => `export class ${name} {\n${fields(names, (n) => `  private readonly ${n}: string = "${n}";`)}\n}\n`;
  expect((await duplications({
    "orders/domain/order-state.ts": klass("OrderState", orderNames),
    "shipping/domain/shipment-state.ts": klass("ShipmentState", shipmentNames),
  })).length).toBeGreaterThan(0);
});

test("negative: a duplicated enum body still fires", async () => {
  const enumOf = (name: string, names: string[]) => `export enum ${name} {\n${fields(names, (n) => `  ${n[0].toUpperCase()}${n.slice(1)} = "${n}",`)}\n}\n`;
  expect((await duplications({
    "orders/domain/order-key.ts": enumOf("OrderKey", orderNames),
    "shipping/domain/shipment-key.ts": enumOf("ShipmentKey", shipmentNames),
  })).length).toBeGreaterThan(0);
});
