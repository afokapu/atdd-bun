#!/usr/bin/env bun
// Member check: tester.bun.telemetry-emit  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of count. Scans TEST FILES ONLY.
import { runCheck, testCases, caseBody } from "../test_header.mjs";

// A telemetry test must assert EMISSION. Identified by its URN kind segment
// (TELEMETRY / EVENT / METRIC) or by `*.telemetry.test.ts` colocation.
//
// A telemetry test that checks a return value proves the function worked, not that
// the event was emitted — and the event is the whole point, because it is what the
// dashboards and alerts downstream are built on.
const IS_TELEMETRY = /-(?:TELEMETRY|EVENT|METRIC)-\d+/i;
const EMISSION_ASSERTION =
  /toHaveBeenCalled(?:With|Times)?\s*\(|expect[\s\S]{0,160}?\.\s*(?:emit|emitted|capture|track|record)\b/;

runCheck("tester.bun.telemetry-emit", (H, file, text) => {
  const byUrn = H.urn && IS_TELEMETRY.test(H.urn.value);
  const byName = /\.telemetry\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
  if (!byUrn && !byName) return null;
  if (EMISSION_ASSERTION.test(text)) return null;
  return { line: H.urn ? H.urn.no : 1,
    evidence: "telemetry test asserts no emission (toHaveBeenCalled / expect on .emit/.capture/.track); a return-value check proves the function ran, not that the event fired",
    source_line: H.urn ? H.urn.raw : "" };
});
