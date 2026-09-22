#!/usr/bin/env bun
// Detector: coder.htmx.verb-mutation-signals-progress  (disposition: suppress-and-clean)
//
// A mutating htmx request (hx-post/put/patch/delete) must declare either
// `hx-indicator` or `hx-disabled-elt`. htmx swaps in place with no navigation, so
// without one of these the page is visually identical while the request is in
// flight: the user gets no feedback and re-clicks, and a non-idempotent POST runs
// twice. The two attributes are the declarative answers — show progress, or
// disable the control — and one of them is required.
//
// GET is deliberately out of scope: a read is idempotent, so a duplicate is
// harmless and an indicator there is a UX preference, not an obligation.
import { walk, readRoots, readExcludes, readText, emit, locate, enclosingTag, SOURCE_EXT, TEMPLATE_EXT } from "../../../lib/scan.mjs";

const RULE_ID = "coder.htmx.verb-mutation-signals-progress";
const MUTATING_RE = /\bhx-(post|put|patch|delete)\s*=/gi;
const SIGNALS_RE = /\bhx-(indicator|disabled-elt)\s*=/i;
const EXTS = new Set([...SOURCE_EXT, ...TEMPLATE_EXT]);

const violations = [];
const excludes = readExcludes();
const seen = new Set(); // one finding per element, not one per mutating verb on it
for (const root of readRoots()) {
  for (const file of walk(root, excludes, EXTS)) {
    const text = readText(file);
    if (!text) continue;
    for (const m of text.matchAll(MUTATING_RE)) {
      const tag = enclosingTag(text, m.index);
      if (tag && SIGNALS_RE.test(tag.text)) continue;
      const key = `${file}:${tag ? tag.start : m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({
        rule_id: RULE_ID,
        file,
        ...locate(text, m.index),
        evidence: `hx-${m[1].toLowerCase()} declares neither hx-indicator nor hx-disabled-elt; an in-flight mutation is invisible and gets re-submitted`,
      });
    }
  }
}
process.stderr.write(`bun-detector[mutation-signals-progress]: ${violations.length} violation(s)\n`);
emit(violations);
