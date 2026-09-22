#!/usr/bin/env bun
// Member check: tester.bun.security-auth  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of count. Scans TEST FILES ONLY.
import { runCheck, testCases, caseBody } from "../test_header.mjs";

// A test that CLAIMS to cover security must actually assert on security. The test
// is identified by its URN kind segment (SEC / RLS / AUTH); the assertion must tie
// an expectation to an identity, permission or 401/403 signal.
//
// A "security" test that only walks the happy path is a SILENT GREEN GAP: it passes
// CI, it is counted as covering the security acceptance, and it proves nothing about
// the denial path — which is the only path that matters.
const IS_SECURITY = /-(?:SEC|RLS|AUTH)-\d+/i;
const AUTH_ASSERTION =
  /expect[\s\S]{0,200}?(?:401|403|[Uu]nauthori[sz]ed|[Ff]orbidden|[Dd]enied|[Pp]ermission|\.rejects\b|toThrow)/;

runCheck("tester.bun.security-auth", (H, file, text) => {
  if (!H.urn || !IS_SECURITY.test(H.urn.value)) return null;
  if (AUTH_ASSERTION.test(text)) return null;
  return { line: H.urn.no,
    evidence: "security test asserts no denial (401/403/unauthorized/forbidden/rejects/toThrow); a happy-path-only security test is a silent green gap",
    source_line: H.urn.raw };
});
