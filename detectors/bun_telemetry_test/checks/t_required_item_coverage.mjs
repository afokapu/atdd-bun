#!/usr/bin/env bun
// Member check: tester.bun.telemetry-required-item-coverage  (telemetry test family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { readRoots, parseJsonEnv, emit } from "../../../lib/scan.mjs";
import { registry, walkTests, parseTestHeader, readText } from "../_shared.mjs";

// The closure from the other side: every item an acceptance REQUIRES must have at
// least one telemetry test bound to it by a Telemetry: header. The implementation
// binding is the coder rule's concern; this is the evidence side — planned telemetry
// that no test proves is a plan nobody can rely on.
const RULE = "tester.bun.telemetry-required-item-coverage";
const DEFAULT_EXCLUDES = ["node_modules", "dist", "build", ".next", ".git", "_generated"];

const { adopted, ids, requiredIds, itemFileById } = await registry();
const violations = [];
if (adopted) {
  const excludes = [...DEFAULT_EXCLUDES, ...parseJsonEnv("ATDD_SCAN_EXCLUDES", [])];
  const bound = new Set();
  for (const root of readRoots()) {
    for (const file of walkTests(root, excludes)) {
      const text = readText(file);
      if (!text) continue;
      for (const reference of parseTestHeader(text).telemetry) bound.add(reference.value);
    }
  }
  for (const id of [...requiredIds].sort()) {
    // An unresolvable required URN is the acceptance-decision rule's finding; judge only declared items.
    if (!ids.has(id) || bound.has(id)) continue;
    violations.push({ rule_id: RULE, file: itemFileById.get(id) ?? "telemetry/", line: 1, col: 1,
      evidence: `${id} is required by an acceptance but no telemetry test binds it with a // Telemetry: header`,
      source_line: "" });
  }
}
process.stderr.write(`bun-telemetry-test[required-item-coverage]: ${violations.length} violation(s)\n`);
emit(violations);
