import { expect, test } from "bun:test";
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
