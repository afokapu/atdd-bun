#!/usr/bin/env bun
// Detector: coder.bun.design-primitives
// App components (outside the design root) render interactive controls through the
// design-system primitive, not raw <button>/<input>/<select>/<textarea> — including the
// HTML an app renders from string/template/tagged-template literals in .ts/.mts files,
// the shape an htmx/Bun server-rendered app actually writes.
import { readRoots, readExcludes, emit, locate } from "../../../lib/scan.mjs";
import { scope, designOf, isComponentSource, isTsSource, masked } from "./_design.mjs";

const RULE_ID = "coder.bun.design-primitives";
const violations = [];
for (const file of scope(readRoots(), readExcludes())) {
  if (designOf(file)) continue;
  // Component sources are judged on code with literals masked; .ts/.mts sources on literal
  // bodies with code masked (the keepLiterals mode), so a match is always authored markup.
  const component = isComponentSource(file), literalHtml = !component && isTsSource(file);
  if (!component && !literalHtml) continue;
  const m = masked(file, literalHtml ? { keepLiterals: true } : undefined);
  if (!m) continue;
  const pattern = component ? /<(button|input|select|textarea)\b/g : /<(button|input|select|textarea)(?=[\s/>])/g;
  for (const c of m.code.matchAll(pattern))
    violations.push({ rule_id: RULE_ID, file, ...locate(m.text, c.index), evidence: `raw <${c[1]}> in app code; compose the design-system primitive instead` });
}
process.stderr.write(`bun-detector[design-primitives]: ${violations.length} violation(s)\n`);
emit(violations);
