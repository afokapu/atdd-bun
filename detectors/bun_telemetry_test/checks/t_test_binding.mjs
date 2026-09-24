#!/usr/bin/env bun
// Member check: tester.bun.telemetry-test-binding  (telemetry test family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { readRoots, parseJsonEnv, emit } from "../../../lib/scan.mjs";
import { registry, walkTests, parseTestHeader, readText } from "../_shared.mjs";

// A telemetry test proves an acceptance's required item, and says so in its header:
// the Telemetry: URN must resolve into the tracking plan, and the Acceptance: it
// carries must be the acceptance whose decision requires that very item.
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
        if (!header.acceptance) {
          violations.push({ rule_id: RULE, file, ...at, evidence: `binds telemetry but no Acceptance: a telemetry test proves an acceptance's required item` });
          continue;
        }
        const acceptance = header.acceptance.value;
        const decision = decisions.get(acceptance);
        if (!decision) {
          violations.push({ rule_id: RULE, file, line: header.acceptance.no, col: 1, source_line: header.acceptance.raw, evidence: `${acceptance} is not a declared acceptance in the plan` });
          continue;
        }
        if (decision.disposition !== "required" || !decision.urns.includes(reference.value)) {
          violations.push({ rule_id: RULE, file, ...at, evidence: `${acceptance} does not require ${reference.value}; bind a test to an acceptance whose telemetry decision lists the item` });
        }
      }
    }
  }
}
process.stderr.write(`bun-telemetry-test[test-binding]: ${violations.length} violation(s)\n`);
emit(violations);
