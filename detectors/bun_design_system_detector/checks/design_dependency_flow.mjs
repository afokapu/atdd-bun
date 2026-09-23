#!/usr/bin/env bun
// Detector: coder.bun.design-dependency-flow
// A design-system file imports only its own layer or a lower one:
// tokens/foundations ← primitives ← components ← templates.
import { readRoots, readExcludes, readText, emit, locate } from "../../../lib/scan.mjs";
import { scope, designOf, importsOf, designTarget } from "./_design.mjs";

const RULE_ID = "coder.bun.design-dependency-flow";
const violations = [];
for (const file of scope(readRoots(), readExcludes())) {
  const here = designOf(file);
  if (!here || here.layer === null) continue;
  const text = readText(file);
  for (const imp of importsOf(text ?? "")) {
    const to = designTarget(file, imp.specifier);
    if (to && to.layer !== null && to.layer > here.layer) violations.push({ rule_id: RULE_ID, file, ...locate(text, imp.index), evidence: `${here.layerName} imports upward into ${to.layerName} ("${imp.specifier}"); depend on the same or a lower layer` });
  }
}
process.stderr.write(`bun-detector[design-dependency-flow]: ${violations.length} violation(s)\n`);
emit(violations);
