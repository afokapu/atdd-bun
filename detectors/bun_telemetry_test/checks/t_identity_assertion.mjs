#!/usr/bin/env bun
// Member check: tester.bun.telemetry-identity-assertion  (telemetry test family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { readRoots, parseJsonEnv, emit, maskComments } from "../../../lib/scan.mjs";
import { registry, walkTests, parseTestHeader, isTelemetryTest, readText } from "../_shared.mjs";

// Exact identity: the concrete URN the test claims to prove must appear in the
// test's CODE (a string literal in an assertion), not only in its header. A test
// that mocks an emitter and asserts "called with anything" proves emission
// happened, not that the planned item is the one that fired.
const RULE = "tester.bun.telemetry-identity-assertion";
const ANY_URN_STRING = /["'`]telemetry:[^"'`\n]+["'`]/;
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
      const code = maskComments(text); // comments do not assert; string literals do
      const claimed = header.telemetry.map((reference) => reference.value);
      if (claimed.length) {
        for (const urn of claimed) {
          if (code.includes(`"${urn}"`) || code.includes(`'${urn}'`) || code.includes("`" + urn + "`")) continue;
          violations.push({ rule_id: RULE, file, line: 1, col: 1,
            evidence: `never asserts the exact identity ${urn}; the URN must appear in an assertion string, not only in the header`,
            source_line: "" });
        }
      } else if (!ANY_URN_STRING.test(code)) {
        violations.push({ rule_id: RULE, file, line: header.urn ? header.urn.no : 1, col: 1,
          evidence: "telemetry test asserts no concrete telemetry identity; assert the exact telemetry: URN the test claims to prove",
          source_line: header.urn ? header.urn.raw : "" });
      }
    }
  }
}
process.stderr.write(`bun-telemetry-test[identity-assertion]: ${violations.length} violation(s)\n`);
emit(violations);
