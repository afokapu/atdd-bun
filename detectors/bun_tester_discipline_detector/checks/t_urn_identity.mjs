#!/usr/bin/env bun
// Member check: tester.bun.test-carries-urn-identity  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Scans TEST FILES ONLY — source files are
// the coder extension's business. Shared parsing lives in ../test_header.mjs.
import { runCheck } from "../test_header.mjs";

runCheck("tester.bun.test-carries-urn-identity", (H) => {
  if (!H.urn) return { line: H.firstMeaningfulNo || 1,
    evidence: "test file carries no `// URN: test:…` header, so nothing can identify what it proves",
    source_line: H.firstMeaningfulText };
  if (!/^test:/.test(H.urn.value)) return { line: H.urn.no,
    evidence: `test URN "${H.urn.value}" does not start with the test: scheme`,
    source_line: H.urn.raw };
  return null;
});
