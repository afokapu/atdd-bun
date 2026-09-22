#!/usr/bin/env bun
// Member check: coder.bun.complexity-cyclomatic  (TypeScript metrics family — native Bun port)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Thresholds and algorithms are transcribed
// from the python-pytest sibling — verified to produce identical numbers — so the
// stack needs no Python to enforce its own metrics.
import { walk, readRoots, readExcludes, readText, emit } from "../../../lib/scan.mjs";
import * as M from "../ts_metrics.mjs";

const RULE = "coder.bun.complexity-cyclomatic";
const LIMIT = M.MAX_CYCLOMATIC;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, M.TS_EXT)) {
    const text = readText(file);
    if (!text) continue;
    for (const f of M.extractFunctions(text)) {
      // The Python detector skips functions under 3 code lines for every
      // per-function metric — a two-line arrow is not a complexity problem.
      if (M.countCodeLines(f.body) < 3) continue;
      const value = M.cyclomatic(f.body);
      if (value <= LIMIT) continue;
      violations.push({
        rule_id: RULE, file, line: f.line, col: 0,
        evidence: `${f.name} complexity=${value} (>${LIMIT})`,
        source_line: (f.body.split("\n")[0] || "").trim(),
      });
    }
  }
}
process.stderr.write(`bun-metrics[cyclomatic]: ${violations.length} violation(s)\n`);
emit(violations);
