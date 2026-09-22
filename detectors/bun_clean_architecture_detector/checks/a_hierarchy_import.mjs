#!/usr/bin/env bun
// Member check: coder.bun.design-hierarchy-import  (clean-architecture family)
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

// Mirrors coder.convex.design-hierarchy-import. Imports point inward:
//   presentation -> application -> domain
//   integration  -> application, domain
//   assembly (composition root) -> anything
const RULE = "coder.bun.design-hierarchy-import";
const ALLOWED = {
  domain: new Set(["domain"]),
  application: new Set(["application", "domain"]),
  integration: new Set(["integration", "application", "domain"]),
  presentation: new Set(["presentation", "application", "domain"]),
  assembly: new Set(["assembly", "presentation", "integration", "application", "domain"]),
};

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const from = layerOf(file);
    if (!from || !ALLOWED[from]) continue;
    const text = readText(file);
    if (!text) continue;
    for (const spec of allImportSpecifiers(text)) {
      const target = resolveSpecifier(spec, file, root);
      if (!target) continue;
      const to = layerOf(target);
      if (!to || ALLOWED[from].has(to)) continue;
      const idx = text.indexOf(spec);
      violations.push({ rule_id: RULE, file, ...locate(text, idx < 0 ? 0 : idx),
        evidence: `${from} imports ${to} ("${spec}"); the hierarchy allows ${from} -> ${[...ALLOWED[from]].join("|")}` });
    }
  }
}
process.stderr.write(`bun-arch[hierarchy-import]: ${violations.length} violation(s)\n`);
emit(violations);
