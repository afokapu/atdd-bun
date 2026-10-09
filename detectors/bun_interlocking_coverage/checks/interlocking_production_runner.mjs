#!/usr/bin/env bun
// Check: tester.bun.interlocking-production-runner-used  (disposition: strict, severity 1)
//
// A test that exercises an interlocking MUST drive the production runtime objects — InterlockingRunner
// (route resolution) and TrainRunner (linear execution), core afokapu/atdd#1251 — and MUST NOT
// substitute a mock/spy/hand-built resolver for them. Bun mirror of core
// tester.interlocking.production-runner-used. Scans `e2e/**/*.ts` interlocking tests.
import { join } from "node:path";
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
  hasProductionExecutionProof,
  stationMasterExecutionProof,
  stationModuleExecutionProof,
  rel,
  mk,
  writeReport,
} from "../_shared/interlocking.mjs";

const RULE = "tester.bun.interlocking-production-runner-used";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
const violations = [];

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    // A test that imports the Station Master drives the runners it composes: the call model's entry point
    // (FWS #sEW3F9b49iA7). It counts only when the Station Master module itself references both production runners;
    // substitutes are still caught by FORBIDDEN_PATTERNS above.
    const station = ["server.ts", join("src", "server.ts")].map((name) => readText(join(croot, name))).find((t) => t && tokenCovered(PROD_INTERLOCKING, maskComments(t)) && tokenCovered(PROD_TRAIN, maskComments(t)));
    const drivesStationMaster = (text) => Boolean(station) && /\bfrom\s+["'][^"']*\bserver(?:\.ts)?["']|import\(\s*["'][^"']*\bserver(?:\.ts)?["']\s*\)/.test(text);
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

      const semantic = hasProductionExecutionProof(text) ||
        records.some((rec) => rec.actions.some((action) => stationMasterExecutionProof(text, action))) ||
        (drivesStationMaster(text) && stationModuleExecutionProof(text, station));
      if (!semantic) {
        violations.push(
          mk(
            RULE,
            r,
            1,
            0,
            `interlocking test "${r}" has no asserted result flowing from production InterlockingRunner ` +
              `resolution into TrainRunner execution; imports and route/train literals are discovery only`,
            "",
          ),
        );
      }
    }
  }
}

writeReport(violations);
