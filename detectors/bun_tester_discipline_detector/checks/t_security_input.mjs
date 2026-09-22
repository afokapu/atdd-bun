#!/usr/bin/env bun
// Member check: tester.bun.security-input  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of count. Scans TEST FILES ONLY.
import { runCheck, testCases, caseBody } from "../test_header.mjs";

// An input-validation test must assert REJECTION. Identified by its URN kind
// segment (INPUT / VALIDATION / VALIDATE).
//
// A test that submits a well-formed payload and checks it succeeds proves nothing
// about how the endpoint handles malformed or adversarial input — which is the
// entire obligation the acceptance claims to discharge.
const IS_INPUT = /-(?:INPUT|VALIDATION|VALIDATE)-\d+/i;
const REJECTION_ASSERTION =
  /expect[\s\S]{0,200}?(?:\.rejects\b|toThrow|400|422|[Ii]nvalid|[Rr]eject|[Vv]alidationError|[Ee]rror)/;

runCheck("tester.bun.security-input", (H, file, text) => {
  if (!H.urn || !IS_INPUT.test(H.urn.value)) return null;
  if (REJECTION_ASSERTION.test(text)) return null;
  return { line: H.urn.no,
    evidence: "input-validation test asserts no rejection (rejects/toThrow/400/422/invalid); it proves only the happy path",
    source_line: H.urn.raw };
});
