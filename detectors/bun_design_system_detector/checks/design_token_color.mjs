#!/usr/bin/env bun
// Detector: coder.bun.design-token-color
// Outside the tokens layer, UI files (.tsx/.jsx/.html/.css) take colors from tokens
// (`var(--…)`), never raw hex, rgb(), or hsl() literals. Defining a custom
// property (`--danger: #b91c1c`) is defining a token, not using a raw value.
// The same declarations are judged in the HTML a .ts/.mts file renders from
// string/template/tagged-template literals, read through the literals-only mask.
import { readRoots, readExcludes, emit, locate } from "../../../lib/scan.mjs";
import { scope, designOf, isUi, isTsSource, masked, declarations } from "./_design.mjs";

const RULE_ID = "coder.bun.design-token-color";
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/;
const violations = [];
for (const file of scope(readRoots(), readExcludes())) {
  const literalHtml = !isUi(file) && isTsSource(file);
  if ((!isUi(file) && !literalHtml) || designOf(file)?.layer === 0) continue;
  const src = masked(file, literalHtml ? { keepLiterals: true } : undefined);
  if (!src) continue;
  for (const d of declarations(file, literalHtml ? src.code : src.text)) {
    if (d.prop.startsWith("--")) continue;
    const hit = d.value.match(COLOR_RE);
    if (hit) violations.push({ rule_id: RULE_ID, file, ...locate(src.text, d.index), evidence: `${d.prop} uses the raw color ${hit[0].replace(/\s*\($/, "()")}; reference a color token (var(--…)) instead` });
  }
}
process.stderr.write(`bun-detector[design-token-color]: ${violations.length} violation(s)\n`);
emit(violations);
