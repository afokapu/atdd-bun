#!/usr/bin/env bun
// Detector: coder.bun.design-wagons-import
// The design system is wagon-agnostic: a file under a design root never imports
// application or wagon code. Wagons import FROM the design system, never the reverse.
import { readRoots, readExcludes, readText, emit, locate } from "../../../lib/scan.mjs";
import { scope, designOf, importsOf, target, designTarget } from "./_design.mjs";

const RULE_ID = "coder.bun.design-wagons-import";
const violations = [];
for (const file of scope(readRoots(), readExcludes())) {
  if (!designOf(file)) continue;
  const text = readText(file);
  for (const imp of importsOf(text ?? "")) {
    if (target(file, imp.specifier)?.path && !designTarget(file, imp.specifier)) violations.push({ rule_id: RULE_ID, file, ...locate(text, imp.index), evidence: `design-system file imports "${imp.specifier}", outside the design root; the design system must not depend on app code` });
  }
}
process.stderr.write(`bun-detector[design-wagons-import]: ${violations.length} violation(s)\n`);
emit(violations);
