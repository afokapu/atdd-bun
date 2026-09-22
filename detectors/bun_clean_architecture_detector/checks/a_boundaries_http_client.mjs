#!/usr/bin/env bun
// Member check: coder.bun.boundaries-http-client  (clean-architecture family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { walk, readRoots, readExcludes, readText, emit, locate, maskLiteralsAndComments, SOURCE_EXT } from "../../../lib/scan.mjs";
import { allImportSpecifiers, layerOf, resolveSpecifier } from "../../../lib/imports.mjs";
import { basename } from "node:path";

// Mirrors coder.vite.boundaries-http-client. An outbound HTTP request goes through
// the project's centralized, contract-driven client, not a bare `fetch()` inside a
// presentation or application module.
//
// SCOPE — outbound calls from the consumer layers only. Integration is where a real
// `fetch` belongs (that is the centralized client's own home), and a TEST fetching
// its own server is exercising it, not depending on it.
const RULE = "coder.bun.boundaries-http-client";
const CONSUMER_LAYERS = new Set(["presentation", "application", "domain"]);
const BARE_FETCH = /\b(?:globalThis\s*\.\s*)?fetch\s*\(|\baxios\s*(?:\.\s*\w+)?\s*\(/g;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    if (!CONSUMER_LAYERS.has(layerOf(file))) continue;
    const text = readText(file);
    if (!text) continue;
    const masked = maskLiteralsAndComments(text);
    for (const m of masked.matchAll(BARE_FETCH)) {
      violations.push({ rule_id: RULE, file, ...locate(text, m.index),
        evidence: `${layerOf(file)} layer calls the platform HTTP primitive directly; route it through the centralized client in integration/` });
    }
  }
}
process.stderr.write(`bun-arch[boundaries-http-client]: ${violations.length} violation(s)\n`);
emit(violations);
