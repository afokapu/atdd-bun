#!/usr/bin/env bun
// Member check: coder.bun.green-urn-pattern  (GREEN/URN traceability family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Zero deps; shared parsing lives in
// ../urn_header.mjs. Evaluates ONE rule over each file's parsed header.
import { runCheck } from "../urn_header.mjs";

runCheck("coder.bun.green-urn-pattern", (H) => {
  if (!H.urn) return null;   // absence is the marker rule's finding, not this one's
  const s = H.segs;
  if (s.length === 6 && s[0] === "component" && s.every((x) => x.length > 0)) return null;
  return { line: H.urn.no, col: H.urn.col,
    evidence: `URN "${H.urn.value}" does not match component:{wagon}:{feature}:{name}:{side}:{layer}`,
    source_line: H.urn.raw };
});
