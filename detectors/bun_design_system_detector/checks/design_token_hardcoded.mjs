#!/usr/bin/env bun
// Detector: coder.bun.design-token-hardcoded
// Outside the tokens layer, spacing, radii, and durations come from foundations.
// 0 and 1px (hairline borders) are not design decisions and are allowed. Custom
// property definitions (`--space-3: 12px`) define tokens and are never judged.
import { readRoots, readExcludes, readText, emit, locate } from "../../../lib/scan.mjs";
import { scope, designOf, isUi, declarations } from "./_design.mjs";

const RULE_ID = "coder.bun.design-token-hardcoded";
const LENGTH_PROP = /^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left|border-radius)(-|$)/;
const DURATION_PROP = /^(transition|animation)(-|$)/;
const violations = [];
const report = (file, text, d, value) => violations.push({ rule_id: RULE_ID, file, ...locate(text, d.index), evidence: `${d.prop}: ${value} is hardcoded; use a foundations token (var(--…))` });
for (const file of scope(readRoots(), readExcludes())) {
  if (!isUi(file) || designOf(file)?.layer === 0) continue;
  const text = readText(file);
  for (const d of declarations(file, text ?? "")) {
    if (LENGTH_PROP.test(d.prop)) {
      if (d.numeric) { if (Math.abs(Number(d.value)) > 1) report(file, text, d, d.value); continue; }
      const px = [...d.value.matchAll(/(-?\d*\.?\d+)px\b/g)].find((m) => Math.abs(Number(m[1])) > 1);
      if (px) report(file, text, d, px[0]);
    } else if (DURATION_PROP.test(d.prop)) {
      const time = [...d.value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)].find((m) => Number(m[1]) > 0);
      if (time) report(file, text, d, time[0]);
    }
  }
}
process.stderr.write(`bun-detector[design-token-hardcoded]: ${violations.length} violation(s)\n`);
emit(violations);
