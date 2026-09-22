#!/usr/bin/env bun
// Member check: coder.bun.dto-mapper  (clean-architecture family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { walk, readRoots, readExcludes, readText, emit, locate, maskLiteralsAndComments, SOURCE_EXT } from "../../../lib/scan.mjs";
import { allImportSpecifiers, layerOf, resolveSpecifier } from "../../../lib/imports.mjs";
import { basename } from "node:path";

// Mirrors coder.convex.dto-mapper. A module that maps between DTOs and domain
// entities lives in `integration/` — mapping is a translation across a boundary,
// which is exactly what the integration layer is for.
const RULE = "coder.bun.dto-mapper";
const MAPPER_FN = /\b(?:function|const)\s+([A-Za-z0-9_]*(?:to|from|map)[A-Za-z0-9_]*DTO[A-Za-z0-9_]*)\b/g;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const layer = layerOf(file);
    if (layer === "integration" || layer === null) continue;
    const text = readText(file);
    if (!text) continue;
    for (const m of text.matchAll(MAPPER_FN)) {
      violations.push({ rule_id: RULE, file, ...locate(text, m.index),
        evidence: `DTO mapper ${m[1]} lives in the ${layer} layer; mappers belong in integration/` });
    }
  }
}
process.stderr.write(`bun-arch[dto-mapper]: ${violations.length} violation(s)\n`);
emit(violations);
