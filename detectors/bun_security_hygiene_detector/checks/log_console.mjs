#!/usr/bin/env bun
// Member check: coder.bun.logging-console  (security/hygiene family)
//
// RE-REALIZED. The python-pytest sibling walks the AST for a bare `print(...)`
// call. The Bun equivalent is `console.*`, and the reason it matters is stronger
// here than in Python: a full-stack Bun server writes `console.log` straight to
// stdout with no level, no timestamp and no request correlation, so production
// logs become an unfilterable stream. Use a logger.
//
// Masked source is scanned, so `console.log` inside a comment or a string never
// trips the rule.
import { walk, readRoots, readExcludes, readText, emit, locate, maskLiteralsAndComments, SOURCE_EXT } from "../../../lib/scan.mjs";

const RULE = "coder.bun.logging-console";
const CONSOLE_RE = /\bconsole\s*\.\s*(log|info|warn|error|debug|trace|dir)\s*\(/g;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const text = readText(file);
    if (!text) continue;
    const masked = maskLiteralsAndComments(text);
    for (const m of masked.matchAll(CONSOLE_RE)) {
      violations.push({
        rule_id: RULE, file, ...locate(text, m.index),
        evidence: `console.${m[1]} writes an unlevelled, uncorrelated line to stdout; use the structured logger`,
      });
    }
  }
}
process.stderr.write(`bun-security[logging-console]: ${violations.length} violation(s)\n`);
emit(violations);
