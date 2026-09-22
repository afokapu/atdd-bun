#!/usr/bin/env bun
// Detector: coder.htmx.swap-oob-carries-id  (disposition: strict)
//
// An out-of-band swap is matched to its destination BY ID: htmx takes the
// `hx-swap-oob` element out of the response and replaces the existing element
// with the same `id`. An oob element carrying no `id` has no destination, so htmx
// silently discards it — the update simply never happens, with no error anywhere.
// This is the single most common htmx bug that presents as "the server is
// returning it but the page doesn't change".
import { walk, readRoots, readExcludes, readText, emit, locate, enclosingTag, SOURCE_EXT, TEMPLATE_EXT } from "../../../lib/scan.mjs";

const RULE_ID = "coder.htmx.swap-oob-carries-id";
const OOB_RE = /\bhx-swap-oob\s*=/gi;
// `id="x"` in markup, or `id={expr}` in JSX — both are a real destination id.
const HAS_ID_RE = /\bid\s*=\s*(['"][^'"]*['"]|\{)/i;
const EXTS = new Set([...SOURCE_EXT, ...TEMPLATE_EXT]);

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, EXTS)) {
    const text = readText(file);
    if (!text) continue;
    for (const m of text.matchAll(OOB_RE)) {
      const tag = enclosingTag(text, m.index);
      if (tag && HAS_ID_RE.test(tag.text)) continue;
      violations.push({
        rule_id: RULE_ID,
        file,
        ...locate(text, m.index),
        evidence: "hx-swap-oob element declares no id, so htmx has no element to swap it into and drops it silently",
      });
    }
  }
}
process.stderr.write(`bun-detector[oob-swap-carries-id]: ${violations.length} violation(s)\n`);
emit(violations);
