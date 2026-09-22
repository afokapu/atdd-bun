#!/usr/bin/env bun
// Member check: coder.bun.green-header-order  (GREEN/URN traceability family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Zero deps; shared parsing lives in
// ../urn_header.mjs. Evaluates ONE rule over each file's parsed header.
import { runCheck } from "../urn_header.mjs";

runCheck("coder.bun.green-header-order", (H) => {
  if (!H.urn) return null;   // nothing to order against; the marker rule owns that
  const seq = [["URN", H.urn.no]];
  if (H.testedBy) seq.push(["Tested-By", H.testedBy.no]);
  if (H.runtime) seq.push(["Runtime", H.runtime.no]);
  if (H.purpose) seq.push(["Purpose", H.purpose.no]);
  for (let i = 1; i < seq.length; i++) {
    if (seq[i][1] < seq[i - 1][1]) {
      return { line: seq[i][1], col: 1,
        evidence: `header out of order: ${seq[i][0]} appears before ${seq[i - 1][0]} (expected URN -> Tested-By -> Runtime -> Purpose)`,
        source_line: (H.lines[seq[i][1] - 1] || "").trim() };
    }
  }
  return null;
});
