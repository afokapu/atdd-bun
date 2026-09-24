#!/usr/bin/env bun
// Member check: coder.bun.telemetry-raw-string-emit  (telemetry code family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT } from "../../../lib/scan.mjs";
import { registry } from "../registry.mjs";
import { maskComments, emitStringCalls, looksLikeEventName } from "../calls.mjs";

// An emit-like call whose first argument is a raw string that names an event must name
// a DECLARED event. Undeclared names are how tracking plans rot: the string compiles,
// the dashboard never fills. A declared raw id passes for now; once generated contracts
// exist, emitting even a declared id by string is drift the contract exists to prevent.
const RULE = "coder.bun.telemetry-raw-string-emit";

const { adopted, ids } = await registry();
const violations = [];
if (adopted) {
  const excludes = readExcludes();
  for (const root of readRoots()) {
    for (const file of walk(root, excludes, SOURCE_EXT)) {
      const text = readText(file);
      if (!text) continue;
      const masked = maskComments(text);
      for (const call of emitStringCalls(masked)) {
        if (!looksLikeEventName(call.value) || ids.has(call.value)) continue;
        violations.push({ rule_id: RULE, file, ...locate(text, call.index),
          evidence: `undeclared raw-string telemetry name '${call.value}'; declare it in the tracking plan (telemetry/<theme>/<artifact>/) and emit it through the generated contract` });
      }
    }
  }
}
process.stderr.write(`bun-telemetry[raw-string-emit]: ${violations.length} violation(s)\n`);
emit(violations);
