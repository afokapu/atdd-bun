#!/usr/bin/env bun
// Member check: coder.bun.composition-root  (clean-architecture family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { walk, readRoots, readExcludes, readText, emit, locate, maskLiteralsAndComments, SOURCE_EXT } from "../../../lib/scan.mjs";
import { allImportSpecifiers, layerOf, resolveSpecifier } from "../../../lib/imports.mjs";
import { basename } from "node:path";

// Mirrors coder.convex.composition-root. Instantiation and wiring of a feature's
// collaborators is confined to a composition root. For this stack the roots are
// `composition.ts`, `wagon.ts` and `server.ts` — the last because `Bun.serve` IS
// the assembly point of a full-stack Bun app, the place routes and their
// dependencies are wired together.
const RULE = "coder.bun.composition-root";
const ROOTS = new Set(["composition.ts", "composition.tsx", "wagon.ts", "server.ts", "index.ts", "index.tsx"]);
const COLLABORATOR = /\bnew\s+([A-Z][A-Za-z0-9_]*(?:Repository|Client|Service|Adapter|Gateway|Store|Provider|Factory))\s*\(/g;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    if (ROOTS.has(basename(file))) continue;      // this IS a composition root
    if (layerOf(file) === "assembly") continue;   // assembly layer is a root by definition
    const text = readText(file);
    if (!text) continue;
    const masked = maskLiteralsAndComments(text);
    for (const m of masked.matchAll(COLLABORATOR)) {
      violations.push({ rule_id: RULE, file, ...locate(text, m.index),
        evidence: `constructs collaborator ${m[1]} outside a composition root; wiring belongs in composition.ts / wagon.ts / server.ts` });
    }
  }
}
process.stderr.write(`bun-arch[composition-root]: ${violations.length} violation(s)\n`);
emit(violations);
