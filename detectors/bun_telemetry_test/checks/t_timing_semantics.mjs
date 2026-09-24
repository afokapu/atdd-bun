#!/usr/bin/env bun
// Member check: tester.bun.telemetry-timing-semantics  (telemetry test family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { readRoots, parseJsonEnv, emit } from "../../../lib/scan.mjs";
import { registry, walkTests, parseTestHeader, readText } from "../_shared.mjs";

// Critical timing semantics are DECLARED on the tracking-plan item (timing:) and
// exercised by the tests bound to it: post-commit, absent-after-rollback,
// correlation-across-async. This is deliberately plan-driven: the check cannot
// prove ordering statically, so it requires the plan to say when ordering matters
// and the bound tests to reference the behaviour. Diagnostic logs and internal
// spans that declare no timing are not judged.
const RULE = "tester.bun.telemetry-timing-semantics";
const DEFAULT_EXCLUDES = ["node_modules", "dist", "build", ".next", ".git", "_generated"];
const SEMANTIC_PROBES = {
  "post-commit": /\bcommits?\b/i,
  "absent-after-rollback": /\brollback\b|\brolled\s+back\b/i,
  "correlation-across-async": /\bcorrelation\b|\bcontext\b/i,
};

const { adopted, ids, timingById, itemFileById } = await registry();
const violations = [];
if (adopted) {
  const excludes = [...DEFAULT_EXCLUDES, ...parseJsonEnv("ATDD_SCAN_EXCLUDES", [])];
  const testsByItem = new Map();
  for (const root of readRoots()) {
    for (const file of walkTests(root, excludes)) {
      const text = readText(file);
      if (!text) continue;
      for (const reference of parseTestHeader(text).telemetry) {
        testsByItem.set(reference.value, [...(testsByItem.get(reference.value) ?? []), text]);
      }
    }
  }
  for (const [id, semantics] of [...timingById].sort(([left], [right]) => left.localeCompare(right))) {
    if (!ids.has(id) || !semantics.length) continue;
    const boundTests = testsByItem.get(id) ?? [];
    for (const semantic of semantics) {
      const probe = SEMANTIC_PROBES[semantic];
      if (probe && boundTests.some((text) => probe.test(text))) continue;
      violations.push({ rule_id: RULE, file: itemFileById.get(id) ?? "telemetry/", line: 1, col: 1,
        evidence: `${id} declares timing semantic '${semantic}' but no bound telemetry test exercises it; assert the emission happens ${semantic === "post-commit" ? "only after commit" : semantic === "absent-after-rollback" ? "never after rollback" : "with correlation context carried across the async handoff"}`,
        source_line: "" });
    }
  }
}
process.stderr.write(`bun-telemetry-test[timing-semantics]: ${violations.length} violation(s)\n`);
emit(violations);
