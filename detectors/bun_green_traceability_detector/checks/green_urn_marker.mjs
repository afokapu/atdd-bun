#!/usr/bin/env bun
// Member check: coder.bun.green-urn-marker  (GREEN/URN traceability family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Zero deps; shared parsing lives in
// ../urn_header.mjs. Evaluates ONE rule over each file's parsed header.
import { runCheck } from "../urn_header.mjs";

runCheck("coder.bun.green-urn-marker", (H) => {
  if (!H.urn) return { line: H.firstMeaningfulNo || 1, col: 1,
    evidence: "missing `URN:` component marker (must be the first meaningful line of the file)",
    source_line: H.firstMeaningfulText };
  if (H.urn.no !== H.firstMeaningfulNo) return { line: H.firstMeaningfulNo, col: 1,
    evidence: "`URN:` marker is not the first meaningful line of the file",
    source_line: H.firstMeaningfulText };
  return null;
});
