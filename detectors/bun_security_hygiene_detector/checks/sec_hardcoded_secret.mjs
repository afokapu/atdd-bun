#!/usr/bin/env bun
// Member check: coder.bun.security-hardcoded-secret  (security/hygiene family)
//
// PORTED VERBATIM. The five secret patterns in the python-pytest sibling are the
// only part of that detector that is language-neutral: an AWS key id, a PEM
// header and an `assignment = "literal"` shape look the same in Python and in
// TypeScript, so the regexes carry over unchanged and the numbers agree.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT, TEMPLATE_EXT } from "../../../lib/scan.mjs";

const RULE = "coder.bun.security-hardcoded-secret";

// Transcribed from SECRET_PATTERNS in security_patterns.py (name, regex, ignoreCase).
const SECRET_PATTERNS = [
  ["aws_access_key", /AKIA[0-9A-Z]{16}/g],
  ["private_key_header", /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g],
  ["password_assignment", /(password|passwd|pwd)\s*=\s*["'][^"']{8,}["']/gi],
  ["api_key_assignment", /(api_key|apikey|api_secret|secret_key)\s*=\s*["'][^"']{8,}["']/gi],
  ["generic_token", /(token|auth_token|access_token)\s*=\s*["'][a-zA-Z0-9_\-]{20,}["']/gi],
];

// `.env.example`-style templates and lockfiles are documentation, not secrets.
const DOC_LIKE = /(\.example|\.sample|\.template)\./;
const EXTS = new Set([...SOURCE_EXT, ...TEMPLATE_EXT]);

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, EXTS)) {
    if (DOC_LIKE.test(file)) continue;
    const text = readText(file);
    if (!text) continue;
    for (const [name, re] of SECRET_PATTERNS) {
      for (const m of text.matchAll(re)) {
        violations.push({
          rule_id: RULE, file, ...locate(text, m.index),
          evidence: `hardcoded secret (${name}) committed to source; move it to the environment`,
        });
      }
    }
  }
}
process.stderr.write(`bun-security[hardcoded-secret]: ${violations.length} violation(s)\n`);
emit(violations);
