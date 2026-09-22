#!/usr/bin/env bun
// Member check: coder.bun.quality-mi  (TypeScript metrics family — native Bun port)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Thresholds and algorithms are transcribed
// from the python-pytest sibling — verified to produce identical numbers — so the
// stack needs no Python to enforce its own metrics.
import { walk, readRoots, readExcludes, readText, emit } from "../../../lib/scan.mjs";
import * as M from "../ts_metrics.mjs";

const RULE = "coder.bun.quality-mi";

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, M.TS_EXT)) {
    const text = readText(file);
    if (!text) continue;
    const mi = M.maintainabilityIndex(text);
    if (mi >= M.MIN_MI) continue;
    violations.push({
      rule_id: RULE, file, line: 1, col: 0,
      evidence: `maintainability index ${mi.toFixed(1)} (< ${M.MIN_MI})`,
      source_line: (text.split("\n")[0] || "").trim(),
    });
  }
}
process.stderr.write(`bun-metrics[mi]: ${violations.length} violation(s)\n`);
emit(violations);
