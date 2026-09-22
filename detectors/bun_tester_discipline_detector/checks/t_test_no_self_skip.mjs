#!/usr/bin/env bun
// Member check: tester.bun.test-no-self-skip  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Scans TEST FILES ONLY. Shared parsing
// lives in ../test_header.mjs.
import { runCheck, testCases, caseBody } from "../test_header.mjs";

// `.fails` / `.failing` are deliberately ABSENT here: core's RED marker vocabulary
// lists `it.fails(` / `test.fails(` as an accepted guaranteed-fail marker, so flagging
// them would refuse the very construct `red-fails-first` REQUIRES. Only genuine
// disabling modifiers are self-skips.
const SELF_SKIP = /\b(?:it|test|describe)\s*\.\s*(skip|todo)\s*\(/g;
// A guarded bail-out: `if (!process.env.X) return;` at the top of a case is a skip
// wearing a disguise — the suite reports green having exercised nothing.
const GUARDED_BAIL = /if\s*\([^)]*process\.env[^)]*\)\s*\{?\s*return\b/g;

runCheck("tester.bun.test-no-self-skip", (H, file, text) => {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const re of [SELF_SKIP, GUARDED_BAIL]) {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (!m) continue;
      out.push({ line: i + 1,
        evidence: m[1]
          ? `test disables itself with .${m[1]}(); a skipped acceptance is an unproven one that reports green`
          : "test bails out on an environment check; the suite passes having exercised nothing",
        source_line: line.trim() });
    }
  });
  return out;
});
