import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";
import { validateStaticPlannerConventions } from "../src/planner-validators";

// THE FULL FRONTEND CHAIN, in both directions: plan/ -> a Bun app -> Playwright browser specs.
// The specs are proven to satisfy the detectors statically AND to pass in a real Chromium; a
// broken page is proven to fail both the static rule and the browser. Chromium must be installed
// (`bunx playwright install chromium`); a missing browser fails these tests, it never skips them.
const packageRoot = resolve(import.meta.dir, ".."), fixture = join(import.meta.dir, "fixtures/frontend-chain");
const excludes = ["node_modules", ".git", ".atdd", "test-results"];

async function copy() {
  const root = await mkdtemp(join(tmpdir(), "atdd-frontend-chain-"));
  await cp(fixture, root, { recursive: true });
  await symlink(join(packageRoot, "node_modules"), join(root, "node_modules"));
  return root;
}
const freePort = () => { const server = Bun.serve({ port: 0, fetch: () => new Response() }); const port = server.port; server.stop(true); return port; };

/** Run Playwright in `root`; return each test's final status by title, plus the run's output for diagnosis. */
async function playwright(root: string, ...args: string[]) {
  const report = join(root, `report-${Date.now()}.json`);
  const child = Bun.spawn({ cmd: [join(root, "node_modules/.bin/playwright"), "test", "-c", "playwright.config.ts", ...args], cwd: root, env: { ...process.env, CHAIN_PORT: String(freePort()), CHAIN_REPORT: report, CI: "1" }, stdout: "pipe", stderr: "pipe" });
  const output = (await new Response(child.stdout).text()) + (await new Response(child.stderr).text());
  await child.exited;
  const statuses = new Map<string, string>();
  type Suite = { specs?: Array<{ title: string; tests: Array<{ results: Array<{ status: string }> }> }>; suites?: Suite[] };
  const walk = (suite: Suite) => { for (const spec of suite.specs ?? []) for (const t of spec.tests) statuses.set(spec.title, t.results.at(-1)?.status ?? "none"); for (const child of suite.suites ?? []) walk(child); };
  try { for (const suite of (JSON.parse(await readFile(report, "utf8")) as { suites: Suite[] }).suites) walk(suite); } catch { /* no report: statuses stay empty and the assertions below show the output */ }
  return { statuses, output: output.slice(-3000) };
}
const failed = (statuses: Map<string, string>) => [...statuses].filter(([, status]) => status !== "passed").map(([title]) => title).sort();

test("the chain fixture satisfies the planner and every frontend detector", async () => {
  expect((await validateStaticPlannerConventions(fixture)).filter(f => f.rule_id.startsWith("planner.journey"))).toEqual([]);
  for (const detector of ["htmx_e2e_detector", "bun_responsive_detector", "bun_design_system_detector"]) expect(await runImplementation(detector, { scanRoots: [fixture], excludes }), detector).toEqual([]);
});

test("every browser spec passes in Chromium", async () => {
  const root = await copy();
  try {
    const baseline = await playwright(root, "--update-snapshots=all", "e2e/buy.visual.e2e.ts");
    expect(failed(baseline.statuses), baseline.output).toEqual([]);
    const run = await playwright(root);
    expect(run.statuses.size, run.output).toBe(9);
    expect(failed(run.statuses), run.output).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 180_000);

test("a page that overflows small screens fails the static rule and the browser at those widths", async () => {
  const root = await copy();
  try {
    const css = join(root, "src/app.css");
    await writeFile(css, (await readFile(css, "utf8")).replace("width: 100%; max-width: 960px;", "width: 960px;"));
    const findings = await runImplementation("bun_responsive_detector", { scanRoots: [root], excludes });
    expect(findings.map(f => `${f.rule_id} ${f.file.slice(root.length + 1)}`)).toEqual(["coder.bun.responsive-no-fixed-width src/app.css"]);
    const run = await playwright(root, "e2e/buy.responsive.e2e.ts");
    expect(failed(run.statuses), run.output).toEqual(["test:journey:buy:RESP-001-fits-every-viewport @ 375px", "test:journey:buy:RESP-001-fits-every-viewport @ 768px"]);
    expect(run.statuses.get("test:journey:buy:RESP-001-fits-every-viewport @ 1280px")).toBe("passed");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 180_000);

test("an inaccessible page fails axe, and a spec that stops running axe is caught statically", async () => {
  const root = await copy();
  try {
    const server = join(root, "src/server.ts");
    await writeFile(server, (await readFile(server, "utf8")).replace('<html lang="en">', "<html>"));
    const run = await playwright(root, "e2e/buy.a11y.e2e.ts");
    expect(failed(run.statuses), run.output).toEqual(["test:journey:buy:A11Y-001-no-violations"]);
    expect(run.output).toContain("html-has-lang");

    const spec = join(root, "e2e/buy.a11y.e2e.ts");
    await writeFile(spec, (await readFile(spec, "utf8")).replace(/  const results[\s\S]*?\n  expect[^\n]*\n/, '  await expect(page.locator("main")).toBeVisible();\n'));
    const findings = await runImplementation("htmx_e2e_detector", { scanRoots: [root], excludes });
    expect(findings.map(f => f.rule_id)).toEqual(["tester.htmx.a11y-harness"]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 180_000);
