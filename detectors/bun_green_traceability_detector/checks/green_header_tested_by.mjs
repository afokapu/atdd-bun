#!/usr/bin/env bun
// Member check: coder.bun.green-header-tested-by  (GREEN/URN traceability family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Zero deps; shared parsing lives in
// ../urn_header.mjs. Evaluates ONE rule over each file's parsed header.
import { runCheck } from "../urn_header.mjs";

runCheck("coder.bun.green-header-tested-by", (H) => {
  if (H.testedBy && H.testedEntries >= 1) return null;
  return { line: H.urn ? H.urn.no : (H.firstMeaningfulNo || 1), col: 1,
    evidence: "missing `Tested-By:` block with at least one `- test:` acceptance URN",
    source_line: H.firstMeaningfulText };
});
