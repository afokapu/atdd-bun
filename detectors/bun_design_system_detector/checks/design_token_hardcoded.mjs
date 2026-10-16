#!/usr/bin/env bun
// Detector: coder.bun.design-token-hardcoded
// Outside the tokens layer, spacing, radii, and durations come from foundations.
// 0 and 1px (hairline borders) are not design decisions and are allowed. Custom
// property definitions (`--space-3: 12px`) define tokens and are never judged.
// The same declarations are judged in the HTML a .ts/.mts file renders from
// string/template/tagged-template literals, read through the literals-only mask.
import { readRoots, readExcludes, emit, locate } from "../../../lib/scan.mjs";
import { scope, designOf, isUi, isTsSource, masked, declarations } from "./_design.mjs";

const RULE_ID = "coder.bun.design-token-hardcoded";
const LENGTH_PROP = /^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left|border-radius)(-|$)/;
const DURATION_PROP = /^(transition|animation)(-|$)/;
const violations = [];
const report = (file, text, d, value) => violations.push({ rule_id: RULE_ID, file, ...locate(text, d.index), evidence: `${d.prop}: ${value} is hardcoded; use a foundations token (var(--…))` });
for (const file of scope(readRoots(), readExcludes())) {
  const literalHtml = !isUi(file) && isTsSource(file);
  if ((!isUi(file) && !literalHtml) || designOf(file)?.layer === 0) continue;
  const src = masked(file, literalHtml ? { keepLiterals: true } : undefined);
  if (!src) continue;
  for (const d of declarations(file, literalHtml ? src.code : src.text)) {
    if (LENGTH_PROP.test(d.prop)) {
      if (d.numeric) { if (Math.abs(Number(d.value)) > 1) report(file, src.text, d, d.value); continue; }
      const px = [...d.value.matchAll(/(-?\d*\.?\d+)px\b/g)].find((m) => Math.abs(Number(m[1])) > 1);
      if (px) report(file, src.text, d, px[0]);
    } else if (DURATION_PROP.test(d.prop)) {
      const time = [...d.value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)].find((m) => Number(m[1]) > 0);
      if (time) report(file, src.text, d, time[0]);
    }
  }
}
process.stderr.write(`bun-detector[design-token-hardcoded]: ${violations.length} violation(s)\n`);
emit(violations);
