#!/usr/bin/env bun
// Member check: coder.bun.commons-domain-no-framework-import  (clean-architecture family)
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

// Mirrors coder.vite.commons-domain-no-framework-import, with this stack's
// framework vocabulary. Vite forbids react/preact/@tanstack/gsap because those are
// ITS frameworks. For a full-stack Bun app the equivalents are the SERVER and
// TRANSPORT primitives: `bun:*`, `node:*`, and the `Bun.` global.
//
// The obligation is identical — the domain layer expresses rules, not machinery —
// and only the list of machinery changes.
const RULE = "coder.bun.commons-domain-no-framework-import";
const FRAMEWORK_SPEC = /^(?:bun:|node:|htmx|@hotwired|express|fastify|koa)/;
const BUN_GLOBAL = /\bBun\s*\./;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    if (layerOf(file) !== "domain") continue;
    const text = readText(file);
    if (!text) continue;
    for (const spec of allImportSpecifiers(text)) {
      if (!FRAMEWORK_SPEC.test(spec)) continue;
      const idx = text.indexOf(spec);
      violations.push({ rule_id: RULE, file, ...locate(text, idx < 0 ? 0 : idx),
        evidence: `domain module imports runtime machinery ("${spec}"); the domain expresses rules, not transport` });
    }
    const g = BUN_GLOBAL.exec(text);
    if (g) {
      violations.push({ rule_id: RULE, file, ...locate(text, g.index),
        evidence: "domain module reaches the Bun global; the domain must be runnable without a server" });
    }
  }
}
process.stderr.write(`bun-arch[domain-no-framework]: ${violations.length} violation(s)\n`);
emit(violations);
