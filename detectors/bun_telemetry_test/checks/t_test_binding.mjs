#!/usr/bin/env bun
// Member check: tester.bun.telemetry-test-binding  (telemetry test family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { readRoots, parseJsonEnv, emit } from "../../../lib/scan.mjs";
import { registry, walkTests, parseTestHeader, readText } from "../_shared.mjs";

// A telemetry test proves an acceptance's required item, and says so in its header:
// the Telemetry: URN must resolve into the tracking plan, and at least ONE of the test's
// Acceptance: bindings must be an acceptance whose decision requires that item — a spec
// file legitimately covers many acceptances, and any of them may be the requiring one.
const RULE = "tester.bun.telemetry-test-binding";
const DEFAULT_EXCLUDES = ["node_modules", "dist", "build", ".next", ".git", "_generated"];

const { adopted, ids, decisions, concreteUrn } = await registry();
const violations = [];
if (adopted) {
  const excludes = [...DEFAULT_EXCLUDES, ...parseJsonEnv("ATDD_SCAN_EXCLUDES", [])];
  for (const root of readRoots()) {
    for (const file of walkTests(root, excludes)) {
      const text = readText(file);
      if (!text) continue;
      const header = parseTestHeader(text);
      for (const reference of header.telemetry) {
        const at = { line: reference.no, col: 1, source_line: reference.raw };
        if (!concreteUrn.test(reference.value)) {
          violations.push({ rule_id: RULE, file, ...at, evidence: `${reference.value} is not a concrete telemetry URN telemetry:{kind}:{plane}:{theme}:{artifact}[:{measure}]` });
          continue;
        }
        if (!ids.has(reference.value)) {
          violations.push({ rule_id: RULE, file, ...at, evidence: `${reference.value} does not resolve to a tracking-plan item under telemetry/` });
          continue;
        }
        if (!header.acceptances.length) {
          violations.push({ rule_id: RULE, file, ...at, evidence: `binds telemetry but no Acceptance: a telemetry test proves an acceptance's required item` });
          continue;
        }
        const names = header.acceptances.map((binding) => binding.value);
        const declared = header.acceptances.filter((binding) => decisions.has(binding.value));
        if (!declared.length) {
          violations.push({ rule_id: RULE, file, line: header.acceptances[0].no, col: 1, source_line: header.acceptances[0].raw, evidence: `${names.join(", ")} — none is a declared acceptance in the plan` });
          continue;
        }
        if (!declared.some((binding) => {
          const decision = decisions.get(binding.value);
          return decision.disposition === "required" && decision.urns.includes(reference.value);
        })) {
          violations.push({ rule_id: RULE, file, ...at, evidence: `${names.join(", ")} — none requires ${reference.value}; bind a test to an acceptance whose telemetry decision lists the item` });
        }
      }
    }
  }
}
process.stderr.write(`bun-telemetry-test[test-binding]: ${violations.length} violation(s)\n`);
emit(violations);
