#!/usr/bin/env bun
// Member check: coder.bun.green-urn-side  (GREEN/URN traceability family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Zero deps; shared parsing lives in
// ../urn_header.mjs. Evaluates ONE rule over each file's parsed header.
import { runCheck } from "../urn_header.mjs";

runCheck("coder.bun.green-urn-side", (H) => {
  if (!H.urn || H.segs.length !== 6) return null;
  // Unchanged from the Python and Vite realizations: `side` is a stack-neutral
  // axis. A full-stack Bun app spans both halves, which is precisely why the
  // segment has to be declared per file rather than inferred from the stack.
  const SIDES = new Set(["frontend", "backend"]);
  if (SIDES.has(H.segs[4])) return null;
  return { line: H.urn.no, col: H.urn.col,
    evidence: `URN side segment "${H.segs[4]}" is not one of frontend|backend`,
    source_line: H.urn.raw };
});
