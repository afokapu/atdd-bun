#!/usr/bin/env bun
// Member check: tester.bun.telemetry-captured-sink  (telemetry test family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { readRoots, parseJsonEnv, emit } from "../../../lib/scan.mjs";
import { registry, walkTests, parseTestHeader, isTelemetryTest, readText } from "../_shared.mjs";

// A telemetry test asserts on the SINK, not the return value: toHaveBeenCalled*
// on the emitted spy, or an expectation on .emit/.emitted/.capture/.track/.record.
// Same predicate family as tester.bun.telemetry-emit, scoped to this profile and
// joined with the exact-identity requirement of tester.bun.telemetry-identity-assertion.
const RULE = "tester.bun.telemetry-captured-sink";
const EMISSION_ASSERTION = /toHaveBeenCalled(?:With|Times)?\s*\(|expect[\s\S]{0,160}?\.\s*(?:emit|emitted|capture|track|record)\b/;
const DEFAULT_EXCLUDES = ["node_modules", "dist", "build", ".next", ".git", "_generated"];

const { adopted } = await registry();
const violations = [];
if (adopted) {
  const excludes = [...DEFAULT_EXCLUDES, ...parseJsonEnv("ATDD_SCAN_EXCLUDES", [])];
  for (const root of readRoots()) {
    for (const file of walkTests(root, excludes)) {
      const text = readText(file);
      if (!text) continue;
      const header = parseTestHeader(text);
      if (!isTelemetryTest(file, header)) continue;
      if (EMISSION_ASSERTION.test(text)) continue;
      violations.push({ rule_id: RULE, file, line: header.urn ? header.urn.no : 1, col: 1,
        evidence: "telemetry test asserts no emission (toHaveBeenCalled / expect on .emit/.capture/.track); a return-value check proves the function ran, not that the item fired",
        source_line: header.urn ? header.urn.raw : "" });
    }
  }
}
process.stderr.write(`bun-telemetry-test[captured-sink]: ${violations.length} violation(s)\n`);
emit(violations);
