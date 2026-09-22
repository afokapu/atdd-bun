#!/usr/bin/env bun
// Member check: tester.bun.acceptance-binding-declared  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Scans TEST FILES ONLY — source files are
// the coder extension's business. Shared parsing lives in ../test_header.mjs.
import { runCheck } from "../test_header.mjs";

runCheck("tester.bun.acceptance-binding-declared", (H) => {
  if (!H.urn) return null;            // owned by test-carries-urn-identity
  // A journey/E2E test binds to a Train instead of an Acceptance; either satisfies
  // the obligation, and exactly this is why the rule reads the header rather than
  // assuming every test maps to one acceptance.
  if (H.acceptance || H.train) return null;
  return { line: H.urn.no,
    evidence: "test declares no `// Acceptance:` (or `// Train:`) binding, so the coverage gate cannot attribute it",
    source_line: H.urn.raw };
});
