#!/usr/bin/env bun
// Member check: coder.bun.dto-placement  (clean-architecture family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { walk, readRoots, readExcludes, readText, emit, locate, maskLiteralsAndComments, SOURCE_EXT } from "../../../lib/scan.mjs";
import { allImportSpecifiers, layerOf, resolveSpecifier } from "../../../lib/imports.mjs";
import { basename } from "node:path";

// Mirrors coder.convex.dto-placement. A `*DTO` type is declared inside a
// `contracts/` module, not inside a wagon's internal layer — a DTO is the shape
// crossing a boundary, so it belongs to the contract, not to either side.
const RULE = "coder.bun.dto-placement";
const DTO_DECL = /\b(?:type|interface)\s+([A-Za-z0-9_]*DTO)\b/g;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    if (file.toLowerCase().split(/[\\/]/).includes("contracts")) continue;
    const text = readText(file);
    if (!text) continue;
    for (const m of text.matchAll(DTO_DECL)) {
      violations.push({ rule_id: RULE, file, ...locate(text, m.index),
        evidence: `${m[1]} is declared outside contracts/; a DTO is the shape crossing a boundary and belongs to the contract` });
    }
  }
}
process.stderr.write(`bun-arch[dto-placement]: ${violations.length} violation(s)\n`);
emit(violations);
