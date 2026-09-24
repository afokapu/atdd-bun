#!/usr/bin/env bun
// Member check: coder.bun.telemetry-implementation-binding  (telemetry code family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { walk, readRoots, readExcludes, readText, emit, SOURCE_EXT } from "../../../lib/scan.mjs";
import { registry } from "../registry.mjs";

// The third edge of the traceability graph: every telemetry item an acceptance
// REQUIRES must be bound to the implementation that emits it, by a Telemetry:
// header in non-test source. A required item no source claims is planned telemetry
// nobody emits — the plan and the code have diverged, and this is where it shows.
const RULE = "coder.bun.telemetry-implementation-binding";
const TELEMETRY_HEADER = /^[ \t]*\/\/[ \t]*Telemetry:[ \t]*(\S+)[ \t]*$/;
const STRING_ON_LINE = /(["'`])(?:\\.|(?!\1)[^\n\\])*\1/g;

const { adopted, ids, requiredIds, itemFileById } = await registry();
const violations = [];
if (adopted) {
  const bound = new Set();
  const excludes = readExcludes();
  for (const root of readRoots()) {
    for (const file of walk(root, excludes, SOURCE_EXT)) {
      const text = readText(file);
      if (!text) continue;
      for (const raw of text.split("\n")) {
        const match = TELEMETRY_HEADER.exec(raw.replace(STRING_ON_LINE, '""'));
        if (match && ids.has(match[1])) bound.add(match[1]);
      }
    }
  }
  for (const id of [...requiredIds].sort()) {
    // An unresolvable required URN is the acceptance-decision rule's finding; judge only declared items.
    if (!ids.has(id) || bound.has(id)) continue;
    violations.push({ rule_id: RULE, file: itemFileById.get(id) ?? "telemetry/", line: 1, col: 1,
      evidence: `${id} is required by an acceptance but no implementation source binds it with a // Telemetry: header`,
      source_line: "" });
  }
}
process.stderr.write(`bun-telemetry[implementation-binding]: ${violations.length} violation(s)\n`);
emit(violations);
