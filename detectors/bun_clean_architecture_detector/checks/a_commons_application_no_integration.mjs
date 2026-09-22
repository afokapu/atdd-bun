#!/usr/bin/env bun
// Member check: coder.bun.commons-application-no-integration  (clean-architecture family)
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

// Mirrors coder.convex.commons-application-no-integration.
// The application layer orchestrates via ports it defines; reaching into
// integration inverts the dependency and welds orchestration to transport.
const RULE = "coder.bun.commons-application-no-integration";

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    if (!commonsRootOf(file) || layerOf(file) !== "application") continue;
    const text = readText(file);
    if (!text) continue;
    for (const spec of allImportSpecifiers(text)) {
      const target = resolveSpecifier(spec, file, root);
      if (!target || layerOf(target) !== "integration") continue;
      const idx = text.indexOf(spec);
      violations.push({ rule_id: RULE, file, ...locate(text, idx < 0 ? 0 : idx),
        evidence: `commons application module imports the integration layer ("${spec}"); depend on a port, not on transport` });
    }
  }
}
process.stderr.write(`bun-arch[commons-application-no-integration]: ${violations.length} violation(s)\n`);
emit(violations);
