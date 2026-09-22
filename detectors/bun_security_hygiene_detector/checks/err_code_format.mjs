#!/usr/bin/env bun
// Member check: coder.bun.error-response-code-format  (security/hygiene family)
//
// PORTED VERBATIM. `"error_code": "VALUE"` must be UPPER_SNAKE_CASE. This is the
// second of the two rules in these three families that is genuinely
// language-neutral: the payload shape is JSON, so the pattern and the
// UPPER_SNAKE_CASE test carry over from error_response.py unchanged.
//
// An error code is a machine key. Once a client branches on it, its spelling is
// API surface, and an inconsistent one ("notFound" beside "NOT_FOUND") produces
// two codes for one condition that no amount of testing will reconcile.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT } from "../../../lib/scan.mjs";

const RULE = "coder.bun.error-response-code-format";

// ERROR_CODE_VALUE_RE and UPPER_SNAKE_CASE_RE, transcribed from error_response.py.
const ERROR_CODE_RE = /['"]error_?[Cc]ode['"]\s*:\s*['"]([^'"]+)['"]/g;
const UPPER_SNAKE_RE = /^[A-Z][A-Z0-9_]+$/;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const text = readText(file);
    if (!text) continue;
    for (const m of text.matchAll(ERROR_CODE_RE)) {
      if (UPPER_SNAKE_RE.test(m[1])) continue;
      violations.push({
        rule_id: RULE, file, ...locate(text, m.index),
        evidence: `error code "${m[1]}" is not UPPER_SNAKE_CASE; the code is API surface once a client branches on it`,
      });
    }
  }
}
process.stderr.write(`bun-security[error-code-format]: ${violations.length} violation(s)\n`);
emit(violations);
