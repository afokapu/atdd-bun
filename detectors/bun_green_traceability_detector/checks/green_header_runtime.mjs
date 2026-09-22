#!/usr/bin/env bun
// Member check: coder.bun.green-header-runtime  (GREEN/URN traceability family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Zero deps; shared parsing lives in
// ../urn_header.mjs. Evaluates ONE rule over each file's parsed header.
import { runCheck } from "../urn_header.mjs";

runCheck("coder.bun.green-header-runtime", (H) => {
  // Bun's runtime vocabulary, where Vite reads vite|browser|node. `bun` is the
  // server half, `browser` the htmx-driven half, and `isomorphic` the modules a
  // full-stack Bun app genuinely runs in BOTH — a fragment renderer used on the
  // server and again after a client-side swap. Vite has no such value because a
  // bundler stack draws that line at build time; Bun draws it at runtime, so the
  // header has to be able to say it.
  const ALLOWED = new Set(["bun", "browser", "isomorphic"]);
  if (!H.runtime) return { line: H.urn ? H.urn.no : (H.firstMeaningfulNo || 1), col: 1,
    evidence: "missing `Runtime:` declaration in the file header",
    source_line: H.firstMeaningfulText };
  if (ALLOWED.has(H.runtime.value)) return null;
  return { line: H.runtime.no, col: 1,
    evidence: `Runtime "${H.runtime.value}" is not one of ${[...ALLOWED].join("|")}`,
    source_line: H.runtime.raw };
});
