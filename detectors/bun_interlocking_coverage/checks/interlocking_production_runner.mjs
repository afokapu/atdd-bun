#!/usr/bin/env bun
// Check: tester.bun.interlocking-production-runner-used  (disposition: strict, severity 1)
//
// A test that exercises an interlocking MUST drive the production runtime objects — InterlockingRunner
// (route resolution) and TrainRunner (linear execution), core afokapu/atdd#1251 — and MUST NOT
// substitute a mock/spy/hand-built resolver for them. Bun mirror of core
// tester.interlocking.production-runner-used. Scans `e2e/**/*.ts` interlocking tests.
import {
  parseJsonEnv,
  readText,
  findConsumerRoots,
  interlockingFiles,
  e2eFiles,
  parseInterlocking,
  interlockingTokenSet,
  isInterlockingTest,
  tokenCovered,
  maskComments,
  lineOfIndex,
  lineAt,
  PROD_INTERLOCKING,
  PROD_TRAIN,
  FORBIDDEN_PATTERNS,
  rel,
  mk,
  writeReport,
} from "../_shared/interlocking.mjs";

const RULE = "tester.bun.interlocking-production-runner-used";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
const violations = [];

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    const records = interlockingFiles(croot)
      .map((f) => parseInterlocking(readText(f)))
      .filter(Boolean);
    const tokens = interlockingTokenSet(records);

    for (const file of e2eFiles(croot)) {
      const raw = readText(file);
      const text = maskComments(raw);
      if (!isInterlockingTest(text, tokens)) continue;
      const r = rel(file, croot);

      for (const [label, pat] of FORBIDDEN_PATTERNS) {
        const m = pat.exec(text);
        if (m) {
          const line = lineOfIndex(text, m.index);
          violations.push(
            mk(
              RULE,
              r,
              line,
              0,
              `interlocking test "${r}" substitutes the production runner (${label}); drive ` +
                `InterlockingRunner -> TrainRunner directly instead`,
              lineAt(raw, line),
            ),
          );
        }
      }

      const missing = [PROD_INTERLOCKING, PROD_TRAIN].filter((sym) => !tokenCovered(sym, text));
      if (missing.length) {
        violations.push(
          mk(
            RULE,
            r,
            1,
            0,
            `interlocking test "${r}" does not reference the production runner(s) ${missing.join(", ")}; ` +
              `it must exercise the real InterlockingRunner -> TrainRunner path (core afokapu/atdd#1251)`,
            "",
          ),
        );
      }
    }
  }
}

writeReport(violations);
