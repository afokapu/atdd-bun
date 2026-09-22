#!/usr/bin/env bun
// Member check: coder.bun.green-header-purpose  (GREEN/URN traceability family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Zero deps; shared parsing lives in
// ../urn_header.mjs. Evaluates ONE rule over each file's parsed header.
import { runCheck } from "../urn_header.mjs";

runCheck("coder.bun.green-header-purpose", (H) => {
  if (!H.purpose) return { line: H.urn ? H.urn.no : (H.firstMeaningfulNo || 1), col: 1,
    evidence: "missing `Purpose:` description in the file header",
    source_line: H.firstMeaningfulText };
  if (H.purpose.value.length <= 80) return null;
  return { line: H.purpose.no, col: 1,
    evidence: `Purpose description is ${H.purpose.value.length} chars (max 80)`,
    source_line: H.purpose.raw };
});
