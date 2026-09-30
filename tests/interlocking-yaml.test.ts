import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";

// An interlocking's routes may be written as a compact list (`routes:` then `- route_id:` at column 0): the same YAML.
// The detectors once parsed it line by line, so a compact file had no routes and every route rule passed without
// judging anything (FWS, atdd-maintainer #G3aXIPPW1Mz5). Each dirty fixture, rewritten compactly, must report exactly
// what it reports as written.
const detectors = resolve(import.meta.dir, "../detectors");
const compact = (text: string) => { let inRoutes = false; return text.split("\n").map(line => { if (/^routes:/.test(line)) { inRoutes = true; return line; } if (/^\S/.test(line)) inRoutes = false; return inRoutes ? line.replace(/^ {2}/, "") : line; }).join("\n"); };
const found = async (detector: string, root: string) => (await runImplementation(detector, { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] })).map(v => `${v.rule_id} ${v.file.slice(root.length + 1)}:${v.line}`).sort();

for (const [detector, fixture] of [["bun_interlocking_coverage", "dirty"], ["bun_interlocking_binding", "dirty"]] as const) {
  test(`${detector}: a compact route list is judged exactly like an indented one`, async () => {
    const root = await mkdtemp(join(tmpdir(), "atdd-compact-"));
    try {
      await cp(join(detectors, detector, "fixtures", fixture), root, { recursive: true });
      const files = [...new Bun.Glob("**/_interlockings/*.yaml").scanSync(root)].map(path => join(root, path));
      expect(files.length).toBeGreaterThan(0);
      const indented = await found(detector, root);
      expect(indented.length).toBeGreaterThan(0);
      for (const file of files) await writeFile(file, compact(await readFile(file, "utf8")));
      expect(await readFile(files[0]!, "utf8")).toMatch(/^routes:\n- route_id:/m);
      expect(await found(detector, root)).toEqual(indented);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("a route whose train passes through a wagon with no source yet is pending; it is judged once the wagon has source", async () => {
  // FWS #ZJOYdwEqnvuP: 26 of 35 routes pass through wagons not built yet. Derived, not declared: nothing can park a route.
  const root = await mkdtemp(join(tmpdir(), "atdd-pending-"));
  try {
    await cp(join(detectors, "bun_interlocking_coverage", "fixtures", "dirty", "interlocking_route_coverage"), root, { recursive: true });
    await writeFile(join(root, "plan", "_trains", "match-resolution-timeout.yaml"), "train_id: train:match:match-resolution-timeout\nsequence:\n- step: 1\n  from: user:player\n  to: wagon:match-voting\n");
    const routes = async () => (await found("bun_interlocking_coverage", root)).filter(line => line.startsWith("tester.bun.interlocking-route-coverage"));
    const pending = await routes();
    const built = async () => { await mkdir(join(root, "src", "wagons", "match-voting", "features", "vote", "domain"), { recursive: true }); await writeFile(join(root, "src", "wagons", "match-voting", "features", "vote", "domain", "vote.ts"), "export const vote = 1;\n"); return routes(); };
    const judged = await built();
    // The other route, whose train document is absent, is judged throughout; the pending one comes back once built.
    expect(judged.length).toBe(pending.length + 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
