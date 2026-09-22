#!/usr/bin/env bun
// Member check: tester.bun.test-phase-declared  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Scans TEST FILES ONLY — source files are
// the coder extension's business. Shared parsing lives in ../test_header.mjs.
import { runCheck } from "../test_header.mjs";

import { PHASES } from "../test_header.mjs";

runCheck("tester.bun.test-phase-declared", (H) => {
  if (!H.urn) return null;
  if (!H.phase) return { line: H.urn.no,
    evidence: "test declares no `// Phase:`; the gate cannot tell a RED test from a SMOKE one",
    source_line: H.urn.raw };
  if (PHASES.has(H.phase.value)) return null;
  return { line: H.phase.no,
    evidence: `Phase "${H.phase.value}" is not one of ${[...PHASES].join("|")}`,
    source_line: H.phase.raw };
});
