#!/usr/bin/env bun
// Detector: coder.htmx.verb-endpoint-same-origin  (disposition: strict)
//
// An htmx verb attribute (hx-get/post/put/patch/delete) must address a
// SAME-ORIGIN path, not a hardcoded absolute URL. htmx swaps the response body
// straight into the DOM, so a cross-origin endpoint is both a CORS failure
// waiting to happen and an untrusted-HTML injection point; a baked-in
// `https://staging.example.com` is also the classic way a staging host ships to
// production. The hypermedia control belongs to the origin that served the page.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT, TEMPLATE_EXT } from "../../../lib/scan.mjs";

const RULE_ID = "coder.htmx.verb-endpoint-same-origin";
const ABSOLUTE_VERB_RE = /\bhx-(get|post|put|patch|delete)\s*=\s*(['"])(https?:)?\/\/[^'"]*\2/gi;
const EXTS = new Set([...SOURCE_EXT, ...TEMPLATE_EXT]);

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, EXTS)) {
    const text = readText(file);
    if (!text) continue;
    for (const m of text.matchAll(ABSOLUTE_VERB_RE)) {
      violations.push({
        rule_id: RULE_ID,
        file,
        ...locate(text, m.index),
        evidence: `hx-${m[1].toLowerCase()} targets an absolute URL; htmx endpoints must be same-origin paths`,
      });
    }
  }
}
process.stderr.write(`bun-detector[endpoint-not-absolute-url]: ${violations.length} violation(s)\n`);
emit(violations);
