#!/usr/bin/env bun
// Detector: coder.htmx.verb-destructive-confirms  (disposition: strict)
//
// An element issuing `hx-delete` must carry `hx-confirm` (or `hx-prompt`). In
// htmx a delete is one attribute on a clickable element — there is no form
// submit, no route transition, no framework-level guard between the user's click
// and the destructive request. `hx-confirm` IS the guard, and it is declarative
// precisely so it cannot be forgotten in a handler. A delete control without one
// destroys data on a single mis-click.
import { walk, readRoots, readExcludes, readText, emit, locate, enclosingTag, SOURCE_EXT, TEMPLATE_EXT } from "../../../lib/scan.mjs";

const RULE_ID = "coder.htmx.verb-destructive-confirms";
const DELETE_RE = /\bhx-delete\s*=/gi;
const CONFIRMS_RE = /\bhx-(confirm|prompt)\s*=/i;
const EXTS = new Set([...SOURCE_EXT, ...TEMPLATE_EXT]);

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, EXTS)) {
    const text = readText(file);
    if (!text) continue;
    for (const m of text.matchAll(DELETE_RE)) {
      const tag = enclosingTag(text, m.index);
      if (tag && CONFIRMS_RE.test(tag.text)) continue;
      violations.push({
        rule_id: RULE_ID,
        file,
        ...locate(text, m.index),
        evidence: "hx-delete without hx-confirm/hx-prompt: one mis-click destroys data with no guard",
      });
    }
  }
}
process.stderr.write(`bun-detector[destructive-verb-confirms]: ${violations.length} violation(s)\n`);
emit(violations);
