#!/usr/bin/env bun
// Detector: coder.bun.design-primitives
// App components (outside the design root) render interactive controls through the
// design-system primitive, not raw <button>/<input>/<select>/<textarea>.
import { readRoots, readExcludes, readText, emit, locate } from "../../../lib/scan.mjs";
import { scope, designOf, isComponentSource, masked } from "./_design.mjs";

const RULE_ID = "coder.bun.design-primitives";
const violations = [];
for (const file of scope(readRoots(), readExcludes())) {
  if (!isComponentSource(file) || designOf(file)) continue;
  const m = masked(file);
  for (const c of (m?.code ?? "").matchAll(/<(button|input|select|textarea)\b/g)) violations.push({ rule_id: RULE_ID, file, ...locate(m.text, c.index), evidence: `raw <${c[1]}> in app code; compose the design-system primitive instead` });
}
process.stderr.write(`bun-detector[design-primitives]: ${violations.length} violation(s)\n`);
emit(violations);
