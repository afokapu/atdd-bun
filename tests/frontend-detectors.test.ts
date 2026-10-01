import { expect, test } from "bun:test";
import { copyFile, cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
