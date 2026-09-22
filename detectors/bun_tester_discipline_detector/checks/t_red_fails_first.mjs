#!/usr/bin/env bun
// Member check: tester.bun.red-fails-first  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of count. Scans TEST FILES ONLY.
import { runCheck, testCases, caseBody } from "../test_header.mjs";

// CORE red.convention.yaml -> red_patterns.typescript, transcribed. Whether a RED
// test ACTUALLY fails first is a RUNTIME property that no static detector can see;
// core supplies a decidable STRUCTURAL proxy — a guaranteed-fail marker must be
// present — and that proxy is what a per-stack detector checks. `test.failing(` is
// bun:test's spelling of vitest's `it.fails(` and is accepted for the same reason.
const RED_MARKERS = [
  /throw\s+new\s+Error\s*\(\s*['"`][^'"`]*[Nn]ot\s+implemented/,
  /throw\s+new\s+UnimplementedError\s*\(/,
  /expect\s*\(\s*false\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)/,
  /expect\s*\(\s*true\s*\)\s*\.\s*toBe\s*\(\s*false\s*\)/,
  /expect\s*\.\s*fail\s*\(/,
  /return\s+Promise\s*\.\s*reject\s*\(/,
  /\b(?:it|test)\s*\.\s*(?:fails|failing)\s*\(/,
];

runCheck("tester.bun.red-fails-first", (H, file, text) => {
  if (!H.phase || H.phase.value !== "RED") return null;
  if (RED_MARKERS.some((re) => re.test(text))) return null;
  return { line: H.phase.no,
    evidence: "RED test carries no guaranteed-fail marker, so nothing stops it passing before the implementation exists",
    source_line: H.phase.raw };
});
