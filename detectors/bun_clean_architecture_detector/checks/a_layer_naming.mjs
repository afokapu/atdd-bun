#!/usr/bin/env bun
// Member check: coder.bun.layer-naming  (clean-architecture family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { walk, readRoots, readExcludes, readText, emit, locate, maskLiteralsAndComments, SOURCE_EXT } from "../../../lib/scan.mjs";
import { allImportSpecifiers, layerOf, resolveSpecifier } from "../../../lib/imports.mjs";
import { basename } from "node:path";

// Mirrors coder.convex.layer-naming. A feature module is named after the
// architectural layer it implements, so a reader knows a file's role before opening
// it and the layering rules have something to read.
//
// Accepts BOTH shapes a real repo uses: the file NAMED for its layer
// (`domain.ts`, `application.ts`, `api.ts`) and the file placed in a directory
// named for its layer (`domain/total.ts`). Convex enforces only the first because
// its function tree is flat; a full-stack Bun repo commonly nests, so refusing the
// directory form would refuse the idiomatic layout.
const RULE = "coder.bun.layer-naming";
const LAYER_FILENAMES = new Set(["domain.ts", "application.ts", "integration.ts",
  "presentation.ts", "api.ts", "assembly.ts", "composition.ts", "wagon.ts",
  "server.ts", "index.ts", "routes.ts"]);
const FEATURE_DIRS = ["features", "wagons"];

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const segs = file.toLowerCase().split(/[\\/]/);
    if (!FEATURE_DIRS.some((d) => segs.includes(d))) continue;   // only feature trees
    if (layerOf(file)) continue;                                  // layer directory: fine
    const base = basename(file).toLowerCase();
    if (LAYER_FILENAMES.has(base)) continue;                      // layer filename: fine
    const text = readText(file);
    violations.push({ rule_id: RULE, file, line: 1, col: 1,
      evidence: `feature module "${basename(file)}" names no architectural layer, by filename or directory`,
      source_line: ((text || "").split("\n")[0] || "").trim() });
  }
}
process.stderr.write(`bun-arch[layer-naming]: ${violations.length} violation(s)\n`);
emit(violations);
