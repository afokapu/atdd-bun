#!/usr/bin/env bun
// Check: tester.bun.interlocking-route-coverage  (disposition: strict, severity 1)
//
// Every admissible route declared in an interlocking's guarded route space (the `routes:` of
// plan/_trains/_interlockings/**/*.yaml, core afokapu/atdd#1248) MUST have at least one e2e test that
// exercises it — referenced by its routeId or resolved trainId in an `e2e/**/*.ts` test. An admissible
// route with no covering e2e test is a silent-green route-control branch. Bun mirror of core
// tester.interlocking.route-coverage.
import {
  parseJsonEnv,
  readText,
  findConsumerRoots,
  interlockingFiles,
  e2eFiles,
  parseInterlocking,
  isRouteCovered,
  maskComments,
  rel,
  mk,
  writeReport,
} from "../_shared/interlocking.mjs";

const RULE = "tester.bun.interlocking-route-coverage";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
const violations = [];

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    const records = interlockingFiles(croot)
      .map((f) => ({ file: f, rec: parseInterlocking(readText(f)) }))
      .filter((x) => x.rec);
    const e2eTexts = e2eFiles(croot).map((f) => maskComments(readText(f)));

    for (const { file, rec } of records) {
      for (const route of rec.routes) {
        if (isRouteCovered(route, e2eTexts)) continue;
        const cat =
          route.category !== null
            ? `category "${route.category}"`
            : "uncategorised";
        violations.push(
          mk(
            RULE,
            rel(file, croot),
            route.line,
            0,
            `admissible route "${route.routeId}" of interlocking "${rec.interlockingId}" (${cat}, ` +
              `resolves to train "${route.trainId}") has no e2e test exercising it; add an e2e/**/*.ts ` +
              `test that references the routeId or trainId and drives it through InterlockingRunner -> TrainRunner`,
            route.sourceLine.trim(),
          ),
        );
      }
    }
  }
}

writeReport(violations);
