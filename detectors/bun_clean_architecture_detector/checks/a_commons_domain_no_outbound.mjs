#!/usr/bin/env bun
// Member check: coder.bun.commons-domain-no-outbound  (clean-architecture family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of count.
//
// Layering rules read the DECLARED dependency, so they use `allImportSpecifiers`
// (type imports included): an `import type` from domain into integration is erased
// at runtime but is still a design coupling a reader must follow, and still a
// violation. That is the opposite call from `dead-code-reachability`, deliberately.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT } from "../../../lib/scan.mjs";
import { allImportSpecifiers, layerOf, commonsRootOf, commonsFeatureOf, resolveSpecifier } from "../../../lib/imports.mjs";

// Mirrors coder.convex.commons-domain-no-outbound / coder.vite.commons-domain-no-outbound.
// Dependencies point INWARD only: the domain is the centre and knows nothing about
// what orchestrates or transports it.
const RULE = "coder.bun.commons-domain-no-outbound";
const FORBIDDEN = ["application", "integration"];

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    if (!commonsRootOf(file) || layerOf(file) !== "domain") continue;
    const text = readText(file);
    if (!text) continue;
    for (const spec of allImportSpecifiers(text)) {
      const target = resolveSpecifier(spec, file, root);
      if (!target) continue;
      const tl = layerOf(target);
      if (!FORBIDDEN.includes(tl)) continue;
      const idx = text.indexOf(spec);
      violations.push({ rule_id: RULE, file, ...locate(text, idx < 0 ? 0 : idx),
        evidence: `commons domain module imports the ${tl} layer ("${spec}"); dependencies point inward only` });
    }
  }
}
process.stderr.write(`bun-arch[commons-domain-no-outbound]: ${violations.length} violation(s)\n`);
emit(violations);
