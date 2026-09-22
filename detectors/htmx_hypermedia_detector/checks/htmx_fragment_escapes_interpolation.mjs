#!/usr/bin/env bun
// Detector: coder.htmx.fragment-escapes-interpolation  (disposition: strict)
//
// In a full-stack Bun + htmx app the server RENDERS HTML FRAGMENTS as template
// literals and htmx injects them into the live DOM. That makes every bare
// `${value}` interpolated into an HTML template a stored-XSS vector: there is no
// framework auto-escaping in the path (that is what React/JSX gave up when the
// stack moved to hypermedia), and the fragment is inserted via innerHTML by
// design. So the escaping obligation, which a JSX stack could leave implicit,
// becomes explicit and enforceable here.
//
// PRECISION: only a BARE identifier or property chain is flagged — `${user.name}`,
// `${row.title}`. An interpolation that is a CALL (`${escapeHtml(x)}`,
// `${rows.map(row).join("")}`) is fragment COMPOSITION or an escape helper and is
// deliberately out of scope; flagging it would drown the rule in false positives
// on legitimate nesting. The rule therefore catches exactly the shape that is
// always wrong: raw data dropped straight into markup.
import { walk, readRoots, readExcludes, readText, emit, locate, templateLiterals, SOURCE_EXT } from "../../../lib/scan.mjs";

const RULE_ID = "coder.htmx.fragment-escapes-interpolation";
// The literal emits markup — an opening tag, not merely a stray `<`.
const EMITS_HTML_RE = /<[a-zA-Z][\w-]*[\s/>]/;
// A bare variable or property chain: no call, no operator, no literal.
const BARE_CHAIN_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

// Collect the `${...}` spans of one template literal, brace-depth aware so a
// nested object literal inside the interpolation does not end it early.
function interpolations(tpl) {
  const spans = [];
  for (let i = 0; i < tpl.length - 1; i++) {
    if (tpl[i] !== "$" || tpl[i + 1] !== "{") continue;
    let depth = 1;
    let j = i + 2;
    while (j < tpl.length && depth > 0) {
      if (tpl[j] === "{") depth++;
      else if (tpl[j] === "}") depth--;
      j++;
    }
    spans.push({ offset: i, expr: tpl.slice(i + 2, j - 1).trim() });
    i = j - 1;
  }
  return spans;
}

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const text = readText(file);
    if (!text) continue;
    for (const tpl of templateLiterals(text)) {
      if (!EMITS_HTML_RE.test(tpl.text)) continue;
      for (const span of interpolations(tpl.text)) {
        if (!BARE_CHAIN_RE.test(span.expr)) continue;
        violations.push({
          rule_id: RULE_ID,
          file,
          ...locate(text, tpl.start + span.offset),
          evidence: `\${${span.expr}} is interpolated raw into an HTML fragment; escape it before htmx swaps it into the DOM`,
        });
      }
    }
  }
}
process.stderr.write(`bun-detector[fragment-interpolation-escaped]: ${violations.length} violation(s)\n`);
emit(violations);
