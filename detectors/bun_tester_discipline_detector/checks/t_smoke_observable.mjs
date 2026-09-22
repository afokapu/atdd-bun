#!/usr/bin/env bun
// Member check: tester.bun.smoke-observable-assertion  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Scans TEST FILES ONLY. Shared parsing
// lives in ../test_header.mjs.
import { runCheck, testCases, caseBody } from "../test_header.mjs";

// Operator-observable channels for a full-stack Bun + htmx app: the HTTP response,
// the rendered markup, the process surface, or persisted state. NOT an intermediate
// object the test constructed itself.
const OBSERVABLE = /\b(?:res|response|resp)\s*\.\s*(?:status|statusText|headers|text|json|ok)\b|\.\s*text\s*\(\s*\)|\.\s*json\s*\(\s*\)|\bstdout\b|\bstderr\b|\bexitCode\b|\bdocument\b|innerHTML|outerHTML/;
const ANY_EXPECT = /\bexpect\s*\(/;

runCheck("tester.bun.smoke-observable-assertion", (H, file, text) => {
  if (!H.phase || H.phase.value !== "SMOKE") return null;
  const out = [];
  for (const c of testCases(text)) {
    const body = caseBody(text, c.line);
    if (!ANY_EXPECT.test(body)) continue;   // owned by the RED/coverage rules
    if (OBSERVABLE.test(body)) continue;
    out.push({ line: c.line,
      evidence: "SMOKE case asserts on no operator-observable channel (response status/body, rendered markup, stdout, exit code)",
      source_line: c.text });
  }
  return out;
});
