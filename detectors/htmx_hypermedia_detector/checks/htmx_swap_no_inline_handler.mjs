#!/usr/bin/env bun
// Detector: coder.htmx.swap-no-inline-handler  (disposition: suppress-and-clean)
//
// In htmx-driven markup, behaviour is declared with hypermedia attributes
// (hx-trigger / hx-on) — not with inline `onclick="..."` JavaScript. An inline
// handler is invisible to htmx's event model, is wiped the moment the element is
// swapped, and cannot be reasoned about by the swap lifecycle; mixing the two is
// how htmx pages acquire ghost handlers that fire on stale nodes.
//
// SELF-SCOPING: only files that actually contain an `hx-` attribute are judged. A
// plain non-htmx page in the same repo is not this rule's business.
// Case-sensitive and lowercase-only by design, so React's `onClick={...}` (a JSX
// prop, not an inline HTML handler) is never flagged.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT, TEMPLATE_EXT } from "../../../lib/scan.mjs";

const RULE_ID = "coder.htmx.swap-no-inline-handler";
const IS_HTMX_FILE_RE = /\bhx-(get|post|put|patch|delete|trigger|target|swap|on)\b/;
const INLINE_HANDLER_RE =
  /\son(click|submit|change|input|load|error|focus|blur|keyup|keydown|mouseover|mouseout)\s*=\s*['"]/g;

const EXTS = new Set([...SOURCE_EXT, ...TEMPLATE_EXT]);

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, EXTS)) {
    const text = readText(file);
    if (!text || !IS_HTMX_FILE_RE.test(text)) continue;
    for (const m of text.matchAll(INLINE_HANDLER_RE)) {
      violations.push({
        rule_id: RULE_ID,
        file,
        ...locate(text, m.index + 1),
        evidence: `inline on${m[1]} handler in htmx markup; declare behaviour with hx-trigger/hx-on so it survives a swap`,
      });
    }
  }
}
process.stderr.write(`bun-detector[no-inline-event-handler]: ${violations.length} violation(s)\n`);
emit(violations);
