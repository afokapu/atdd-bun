#!/usr/bin/env bun
// Member check: coder.bun.composition-consumer  (clean-architecture family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { walk, readRoots, readExcludes, readText, emit, locate, maskLiteralsAndComments, SOURCE_EXT } from "../../../lib/scan.mjs";
import { allImportSpecifiers, layerOf, resolveSpecifier } from "../../../lib/imports.mjs";
import { basename } from "node:path";

// Mirrors coder.convex.composition-consumer. A CONSUMER layer — presentation or
// application — receives its collaborators by injection rather than constructing
// them. `composition-root` says where wiring may happen; this says that consumers
// must accept what they are given, which is the half that makes them testable.
const RULE = "coder.bun.composition-consumer";
const CONSUMER_LAYERS = new Set(["presentation", "application"]);
const COLLABORATOR = /\bnew\s+([A-Z][A-Za-z0-9_]*(?:Repository|Client|Service|Adapter|Gateway|Store|Provider|Factory))\s*\(/g;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    if (!CONSUMER_LAYERS.has(layerOf(file))) continue;
    const text = readText(file);
    if (!text) continue;
    const masked = maskLiteralsAndComments(text);
    for (const m of masked.matchAll(COLLABORATOR)) {
      violations.push({ rule_id: RULE, file, ...locate(text, m.index),
        evidence: `${layerOf(file)} layer constructs ${m[1]} instead of receiving it; a consumer that builds its own collaborators cannot be tested without them` });
    }
  }
}
process.stderr.write(`bun-arch[composition-consumer]: ${violations.length} violation(s)\n`);
emit(violations);
