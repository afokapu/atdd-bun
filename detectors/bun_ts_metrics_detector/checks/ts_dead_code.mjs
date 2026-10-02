#!/usr/bin/env bun
// Member check: coder.bun.dead-code-reachability  (TypeScript metrics family)
//
// Cross-file, unlike its siblings: it builds the module import graph, walks it
// from the structural roots (index/wagon/composition/main/app, and files package.json
// scripts run), and reports files
// reached by nothing in either direction.
//
// The import edges come from Bun's IN-PROCESS TypeScript parser rather than the
// regex set the Python sibling must use, so `import type` — erased at compile time
// and therefore not a runtime edge — no longer keeps a dead module alive. Same
// obligation, measured correctly, and only possible because the runtime is Bun.
import { walk, readRoots, readExcludes, readText, emit } from "../../../lib/scan.mjs";
import * as M from "../ts_metrics.mjs";
import { basename, dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";

const RULE = "coder.bun.dead-code-reachability";

// A file a package.json script runs (`bun run docs/gen.ts`, `bun tools/x.ts`) is an entry point the
// repository itself declares, so it is a root too. The nearest package.json at or above the scan root.
function scriptRoots(root, all) {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      let scripts = {};
      try { scripts = JSON.parse(readText(manifest) || "{}").scripts ?? {}; } catch { return []; }
      const out = [];
      for (const command of Object.values(scripts)) {
        for (const [, path] of String(command).matchAll(/(?:^|[\s"'=])((?:\.\/)?[\w@./-]+\.tsx?)(?=$|[\s"';&|)])/g)) {
          const file = join(dir, path);
          if (all.has(file)) out.push(file);
        }
      }
      return out;
    }
    if (dirname(dir) === dir) return [];
  }
}

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  const files = [...walk(root, excludes, M.TS_EXT, true)];
  if (!files.length) continue;
  const all = new Set(files);

  const graph = new Map();
  const sources = new Map();
  for (const f of files) {
    const text = readText(f);
    sources.set(f, text ?? "");
    const targets = new Set();
    for (const spec of M.moduleImports(text ?? "", f)) {
      for (const c of M.resolveImport(spec, f, all, root)) targets.add(c);
    }
    graph.set(f, targets);
  }

  const roots = new Set([...files.filter(M.isRootFile), ...scriptRoots(root, all)]);
  // No structural root means no anchor to measure reachability FROM; reporting
  // every file as dead would be noise, not a finding. The Python sibling bails
  // the same way.
  if (!roots.size) continue;

  const forward = M.reachableFrom(roots, graph);
  const backward = M.reachableFrom(roots, M.reverseGraph(graph));

  for (const f of files) {
    if (forward.has(f) || backward.has(f)) continue;
    if (M.STRUCTURAL.has(basename(f))) continue;  // index.ts is structural, like __init__.py
    if (M.isTestFile(f)) continue;                // a test is an entrypoint, not dead code
    violations.push({
      rule_id: RULE, file: f, line: 1, col: 0,
      evidence: `unreachable TypeScript file: ${basename(f)}`,
      source_line: ((sources.get(f) || "").split("\n")[0] || "").trim(),
    });
  }
}
process.stderr.write(`bun-metrics[dead-code]: ${violations.length} violation(s)\n`);
emit(violations);
