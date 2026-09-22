#!/usr/bin/env bun
// Member check: tester.bun.smoke-no-collaborator-substitution  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Scans TEST FILES ONLY. Shared parsing
// lives in ../test_header.mjs.
import { runCheck, testCases, caseBody } from "../test_header.mjs";

const SUBSTITUTION = /\b(?:mock\s*\.\s*module|spyOn|jest\s*\.\s*(?:mock|spyOn)|vi\s*\.\s*(?:mock|spyOn)|mock\s*\.\s*restore)\s*\(/g;

runCheck("tester.bun.smoke-no-collaborator-substitution", (H, file, text) => {
  if (!H.phase || H.phase.value !== "SMOKE") return null;
  const out = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    SUBSTITUTION.lastIndex = 0;
    const m = SUBSTITUTION.exec(line);
    if (!m) return;
    out.push({ line: i + 1,
      evidence: `SMOKE test substitutes a production collaborator (${m[0].replace(/\s*\($/, "").trim()}); that makes it a unit test passing under a SMOKE label`,
      source_line: line.trim() });
  });
  return out;
});
