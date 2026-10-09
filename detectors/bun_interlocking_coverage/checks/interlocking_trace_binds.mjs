#!/usr/bin/env bun
// Check: tester.bun.interlocking-trace-binds-declared-route  (disposition: strict, severity 1)
//
// A test that asserts on the runtime trace emitted by interlocking execution MUST bind that trace back
// to the source interlocking declaration — it must assert EVERY required trace field so the executed
// route is traceable to the YAML it came from (core afokapu/atdd#1248/#1251). Bun mirror of core
// tester.interlocking.trace-binds-declared-route. Required TS trace fields: interlockingId, routeId,
// selectedTrainId, routeCategory, routeCategoryDigit, guardId, resolutionStrategy, resolutionReason.
import {
  parseJsonEnv,
  readText,
  findConsumerRoots,
  interlockingFiles,
  e2eFiles,
  parseInterlocking,
  interlockingTokenSet,
  isInterlockingTest,
  maskComments,
  lineOfIndex,
  lineAt,
  TRACE_OBJECT,
  REQUIRED_TRACE_FIELDS,
  assertedTraceFields,
  traceHasProductionProvenance,
  rel,
  mk,
  writeReport,
} from "../_shared/interlocking.mjs";

const RULE = "tester.bun.interlocking-trace-binds-declared-route";
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
      const m = TRACE_OBJECT.exec(text);
      if (!m) continue; // not a trace-binding test.
      const missing = assertedTraceFields(text);
      const provenance = traceHasProductionProvenance(text);
      if (!missing.length && provenance) continue;
      const line = lineOfIndex(text, m.index);
      violations.push(
        mk(
          RULE,
          rel(file, croot),
          line,
          0,
          `interlocking trace test "${rel(file, croot)}" does not bind a production TrainRunner result to the ` +
            `declared route${missing.length ? `: missing asserted trace field(s) ${missing.join(", ")}` : ""}${!provenance ? "; trace is not derived from InterlockingRunner -> TrainRunner execution" : ""}`,
          lineAt(raw, line),
        ),
      );
    }
  }
}

writeReport(violations);
