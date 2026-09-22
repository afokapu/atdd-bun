#!/usr/bin/env bun
// Member check: coder.bun.green-urn-wagon-feature  (GREEN/URN traceability family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Zero deps; shared parsing lives in
// ../urn_header.mjs. Evaluates ONE rule over each file's parsed header.
import { runCheck } from "../urn_header.mjs";

runCheck("coder.bun.green-urn-wagon-feature", (H) => {
  if (!H.urn || H.segs.length !== 6 || H.segs[0] !== "component") return null;
  const KEBAB = /^[a-z][a-z0-9-]*$/;
  const bad = [];
  if (!KEBAB.test(H.segs[1])) bad.push(`wagon "${H.segs[1]}"`);
  if (!KEBAB.test(H.segs[2])) bad.push(`feature "${H.segs[2]}"`);
  if (bad.length === 0) return null;
  return { line: H.urn.no, col: H.urn.col,
    evidence: `URN ${bad.join(" and ")} is not a kebab-case identifier (^[a-z][a-z0-9-]*$)`,
    source_line: H.urn.raw };
});
