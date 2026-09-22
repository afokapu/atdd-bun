#!/usr/bin/env bun
// Detector: coder.bun.runtime-typecheck-enforced  (disposition: advisory)
//
// THE GAP THIS CLOSES. Bun runs `.ts` by STRIPPING types — it transpiles, it does not
// typecheck. No `tsc` is bundled. So a Bun app is, by default, less type-safe than a
// tsc-based one: `resolveTrain()` can return something structurally wrong and Bun will
// run it happily. Real typechecking means TypeScript as a dependency and a no-emit
// typecheck wired into the check path.
//
// This is COMPLEMENTARY to the interlocking detectors, not overlapping. Those are
// regex-over-source and verify SHAPE — that an `InterlockingResolution` declaring the
// eight fields exists. They cannot verify that what `resolveTrain` actually returns
// conforms to it. Only a typechecker can, and only if one is run.
//
// DELIBERATELY UNFORCED, in four ways, because this rule states a stack norm rather
// than a single blessed incantation:
//
//   1. SCOPE. Only a tree that is actually a TypeScript project carries the obligation
//      — a package.json AND at least one .ts/.tsx file. A JS-only Bun app is silent.
//   2. HOW. Any recognised no-emit typechecker in any script satisfies it: tsc
//      --noEmit, tsgo --noEmit, vue-tsc, svelte-check, astro check, bunx tsc, or a
//      script named typecheck/check-types/check:types. The obligation is that types
//      ARE checked, never that they are checked one particular way.
//   3. WHERE. TypeScript counts from devDependencies OR dependencies.
//   4. STRICTNESS. Reported ONLY when demonstrably off — an explicit `"strict": false`,
//      or no strict family flag at all in a config that extends nothing. A tsconfig
//      that `extends` a base is NOT flagged: this detector cannot resolve the base, and
//      reporting what it cannot see would be a false positive. That is the same
//      discipline the rest of this hub applies to could-not-determine.
import { readRoots, readExcludes, emit, readText } from "../../../lib/scan.mjs";
import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const RULE_ID = "coder.bun.runtime-typecheck-enforced";

// A no-emit typechecker invocation, in any script. Permissive by design (see 2 above).
const TYPECHECK_CMD =
  /\b(?:tsc|tsgo)\b[^&|;]*--?noEmit\b|\bvue-tsc\b|\bsvelte-check\b|\bastro\s+check\b|\btsc\s+--build\b/;
const TYPECHECK_SCRIPT_NAME = /^(?:typecheck|type-check|check[:-]types|types)$/i;

function* walkFiles(dir, excludes, depth = 0) {
  if (depth > 6) return;
  let entries;
  try { entries = readdirSync(dir).sort(); } catch { return; }
  // SORTED. readdirSync order is filesystem-dependent, and an unsorted walk made
  // this check non-deterministic: with several packages in one tree, WHICH one got
  // checked varied by machine, so CI and a laptop could disagree about a clean repo.
  for (const name of entries) {
    if (excludes.some((e) => name === e)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) yield* walkFiles(full, excludes, depth + 1);
    else yield full;
  }
}

const violations = [];
const excludes = [...readExcludes(), "node_modules", "dist", "build", ".next", ".git"];

for (const root of readRoots()) {
  const files = [...walkFiles(root, excludes)].sort();
  // EVERY package.json is a project root, not just the first one found. Checking
  // only the first meant a monorepo — a common Bun shape — had one package audited
  // and the rest silently ignored, and which one it was depended on readdir order.
  const pkgPaths = files.filter((f) => f.endsWith(sep + "package.json") || f.endsWith("/package.json"));

for (const pkgPath of pkgPaths) {
  const projectDir = pkgPath.slice(0, pkgPath.length - "package.json".length - 1);
  // Files belonging to THIS package: under its directory, and not under a nested
  // package (which is its own project root and gets its own pass).
  const nested = pkgPaths.filter((o) => o !== pkgPath && o.startsWith(projectDir + sep));
  const nestedDirs = nested.map((o) => o.slice(0, o.length - "package.json".length - 1) + sep);
  const owned = files.filter(
    (f) => f.startsWith(projectDir + sep) && !nestedDirs.some((n) => f.startsWith(n)),
  );
  const hasTs = owned.some((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"));
  if (!hasTs) continue;                                     // JS-only Bun app: no obligation

  let pkg;
  try { pkg = JSON.parse(readText(pkgPath)); } catch { continue; }  // unreadable: say nothing
  const rel = (p) => p.slice(root.length).replace(/^[/\\]/, "");
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const scripts = pkg.scripts || {};

  const hasTypescript = Object.keys(deps).some((d) => d === "typescript" || d === "@typescript/native-preview");
  const wired = Object.entries(scripts).some(
    ([name, cmd]) => TYPECHECK_CMD.test(String(cmd)) || TYPECHECK_SCRIPT_NAME.test(name),
  );

  if (!hasTypescript) {
    violations.push({
      rule_id: RULE_ID, file: rel(pkgPath), line: 1, col: 1, source_line: '"devDependencies"',
      evidence:
        "typescript is not a dependency, so nothing in this project can typecheck it — " +
        "bun strips types to run .ts and never checks them",
    });
  }
  if (!wired) {
    violations.push({
      rule_id: RULE_ID, file: rel(pkgPath), line: 1, col: 1, source_line: '"scripts"',
      evidence:
        "no script runs a no-emit typecheck (tsc --noEmit, vue-tsc, svelte-check, astro check, " +
        "or a typecheck script), so types are never checked in the check path",
    });
  }

  const tsconfigPath = owned.find((f) => /(?:^|[/\\])tsconfig\.json$/.test(f));
  if (!tsconfigPath) {
    violations.push({
      rule_id: RULE_ID, file: rel(pkgPath), line: 1, col: 1, source_line: '"typescript"',
      evidence: "no tsconfig.json, so a typecheck would run with unpinned compiler options",
    });
    continue;
  }
  const raw = readText(tsconfigPath);
  const extendsBase = /"extends"\s*:/.test(raw);
  const strictOff = /"strict"\s*:\s*false/.test(raw);
  const strictFamily = /"strict(?:NullChecks|FunctionTypes|BindCallApply|PropertyInitialization)?"\s*:\s*true/.test(raw);
  if (strictOff || (!strictFamily && !extendsBase)) {
    violations.push({
      rule_id: RULE_ID,
      file: rel(tsconfigPath), line: 1, col: 1, source_line: '"compilerOptions"',
      evidence: strictOff
        ? 'tsconfig sets "strict": false, so the typecheck that does run accepts implicit any and unchecked null'
        : 'tsconfig enables no strict flag and extends no base, so the typecheck that does run accepts implicit any and unchecked null',
    });
  }
}
}

process.stderr.write(`bun-detector[typecheck-enforced]: ${violations.length} violation(s)\n`);
emit(violations);
