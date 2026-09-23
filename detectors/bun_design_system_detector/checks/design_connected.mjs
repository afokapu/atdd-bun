#!/usr/bin/env bun
// Detector: coder.bun.design-connected
// Every app component that renders markup imports at least one design-system
// element, so no UI surface is disconnected from the shared system.
import { readRoots, readExcludes, readText, emit, locate } from "../../../lib/scan.mjs";
import { scope, designOf, isComponentSource, masked, importsOf, designTarget } from "./_design.mjs";

const RULE_ID = "coder.bun.design-connected";
const violations = [];
for (const file of scope(readRoots(), readExcludes())) {
  if (!isComponentSource(file) || designOf(file)) continue;
  const m = masked(file);
  if (!m) continue;
  const renders = m.code.search(/<\/[A-Za-z]|\/>/);
  if (renders === -1 || importsOf(m.text).some((imp) => designTarget(file, imp.specifier))) continue;
  violations.push({ rule_id: RULE_ID, file, ...locate(m.text, renders), evidence: "component renders markup but imports nothing from the design system" });
}
process.stderr.write(`bun-detector[design-connected]: ${violations.length} violation(s)\n`);
emit(violations);
