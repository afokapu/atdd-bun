#!/usr/bin/env bun
// Member check: coder.bun.green-urn-layer  (GREEN/URN traceability family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Zero deps; shared parsing lives in
// ../urn_header.mjs. Evaluates ONE rule over each file's parsed header.
import { runCheck } from "../urn_header.mjs";

runCheck("coder.bun.green-urn-layer", (H) => {
  if (!H.urn || H.segs.length !== 6) return null;
  const LAYERS = new Set(["domain", "application", "integration", "presentation", "assembly"]);
  if (LAYERS.has(H.segs[5])) return null;
  return { line: H.urn.no, col: H.urn.col,
    evidence: `URN layer segment "${H.segs[5]}" is not one of domain|application|integration|presentation|assembly`,
    source_line: H.urn.raw };
});
