#!/usr/bin/env bun
// Member check: tester.bun.red-behavioral-assertion  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Scans TEST FILES ONLY. Shared parsing
// lives in ../test_header.mjs.
import { runCheck, testCases, caseBody } from "../test_header.mjs";

const VACUOUS = /\bexpect\s*\([^)]*\)\s*\.\s*(?:not\s*\.\s*)?(toBeDefined|toBeTruthy|toBeFalsy|toBeNull|toBeUndefined)\s*\(/g;
const ANY_EXPECT = /\bexpect\s*\(/;

runCheck("tester.bun.red-behavioral-assertion", (H, file, text) => {
  if (!H.phase || H.phase.value !== "RED") return null;
  const out = [];
  for (const c of testCases(text)) {
    const body = caseBody(text, c.line);
    if (!ANY_EXPECT.test(body)) {
      out.push({ line: c.line,
        evidence: "RED test case asserts nothing; it cannot fail first on behaviour that does not exist",
        source_line: c.text });
      continue;
    }
    // Every assertion is an existence check -> the test passes as soon as the
    // symbol exists, which is precisely what RED must NOT do.
    const vacuous = (body.match(VACUOUS) || []).length;
    const total = (body.match(/\bexpect\s*\(/g) || []).length;
    if (vacuous > 0 && vacuous === total) {
      out.push({ line: c.line,
        evidence: "RED test asserts only existence (toBeDefined/toBeTruthy/…); assert the BEHAVIOUR that must fail first",
        source_line: c.text });
    }
  }
  return out;
});
