#!/usr/bin/env bun
// Member check: tester.bun.test-imports-bun-test  (tester discipline family)
//
// MOVED from bun_fullstack_detector, where it was a `coder.bun.*` rule. It reads
// TEST files, and `conformance/test_persona_scoping.py` proved that broke the
// boundary this provider claims: coder families never open a test file. The rule's
// own argument is about the coverage gate — a test bound to a harness the declared
// runner never executes is coverage the gate believes in and that never ran — and
// that is a tester obligation, not a source one.
import { runCheck } from "../test_header.mjs";

const RULE = "tester.bun.test-imports-bun-test";
const FOREIGN_HARNESS_RE =
  /\b(?:import|from|require\s*\()\s*['"](vitest|@jest\/globals|jest|mocha|chai)['"]/g;

runCheck(RULE, (H, file, text) => {
  // Mask line comments only: the harness name lives INSIDE the import's own string
  // literal, so masking literals would blank the very thing being matched.
  const masked = text.replace(/\/\/[^\n]*/g, (s) => " ".repeat(s.length));
  const out = [];
  for (const m of masked.matchAll(FOREIGN_HARNESS_RE)) {
    const before = text.slice(0, m.index);
    out.push({
      line: before.split("\n").length,
      col: m.index - (before.lastIndexOf("\n") + 1) + 1,
      evidence: `test imports '${m[1]}' instead of 'bun:test'; the declared runner is bun, so this test is not run by the harness the gate reports`,
      source_line: (text.split(/\r?\n/)[before.split("\n").length - 1] || "").trim(),
    });
  }
  return out;
});
