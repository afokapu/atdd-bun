#!/usr/bin/env bun
// Member check: coder.bun.commons-cross-feature-imports-in  (clean-architecture family)
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

// Mirrors coder.convex.commons-cross-feature-imports-in.
// A file inside `commons/<layer>/<feature>/` must not reach directly into a
// SIBLING feature's internals; cross-feature use goes through the layer root, which
// is the surface each feature deliberately exposes.
const RULE = "coder.bun.commons-cross-feature-imports-in";

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const feature = commonsFeatureOf(file);
    if (!feature) continue;
    const text = readText(file);
    if (!text) continue;
    for (const spec of allImportSpecifiers(text)) {
      const target = resolveSpecifier(spec, file, root);
      if (!target) continue;
      const other = commonsFeatureOf(target);
      if (!other || other === feature) continue;
      const idx = text.indexOf(spec);
      violations.push({ rule_id: RULE, file, ...locate(text, idx < 0 ? 0 : idx),
        evidence: `commons feature "${feature}" imports into sibling feature "${other}" ("${spec}"); go through the layer root` });
    }
  }
}
process.stderr.write(`bun-arch[commons-cross-feature]: ${violations.length} violation(s)\n`);
emit(violations);
