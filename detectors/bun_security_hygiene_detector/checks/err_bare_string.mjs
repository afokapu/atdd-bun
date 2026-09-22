#!/usr/bin/env bun
// Member check: coder.bun.error-response-bare-string  (security/hygiene family)
//
// RE-REALIZED. The python-pytest sibling matches FastAPI's
// `HTTPException(detail="...")`. Bun has no exception-to-response machinery: an
// error IS a `Response` with a 4xx/5xx status, so the equivalent fault is
// `new Response("something went wrong", { status: 400 })` — a bare human string
// where a structured, coded payload belongs.
//
// This matters more in an htmx app than in a JSON API, and that is worth being
// explicit about: htmx swaps the response body into the DOM, so a bare error
// string is not merely unstructured — it is rendered to the user verbatim,
// including whatever internal detail it happens to carry.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT } from "../../../lib/scan.mjs";

const RULE = "coder.bun.error-response-bare-string";

// `new Response(<string literal>, { ... status: 4xx|5xx ... })` — the status may
// precede or follow other options, so the options object is matched loosely.
const BARE_ERROR_RESPONSE_RE =
  /new\s+Response\s*\(\s*(['"`])((?:[^'"`\\]|\\.)*)\1\s*,\s*\{[^}]*\bstatus\s*:\s*([45]\d{2})/g;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const text = readText(file);
    if (!text) continue;
    for (const m of text.matchAll(BARE_ERROR_RESPONSE_RE)) {
      violations.push({
        rule_id: RULE, file, ...locate(text, m.index),
        evidence: `HTTP ${m[3]} returns the bare string "${m[2].slice(0, 40)}"; return a structured payload carrying an error_code`,
      });
    }
  }
}
process.stderr.write(`bun-security[error-bare-string]: ${violations.length} violation(s)\n`);
emit(violations);
