#!/usr/bin/env bun
// Check: tester.bun.interlocking-smoke-coverage-for-station-master  (disposition: strict, severity 1)
//
// Every EXPOSED Station Master action of an interlocking (entrypoint.exposed:true with an actions
// entry, core afokapu/atdd#1248) MUST have a smoke test that drives the action through the real
// entrypoint -> Station Master -> InterlockingRunner -> TrainRunner path (#1251). Internal
// (exposed:false) interlockings have no Station Master action and are OUT OF SCOPE. Bun mirror of
// core tester.interlocking.smoke-coverage-for-station-master. The enforced minimum smoke signature is
// an `e2e/**/*.ts` file referencing the action name AND a Station Master reference AND both runners.
import {
  parseJsonEnv,
  readText,
  findConsumerRoots,
  interlockingFiles,
  e2eFiles,
  parseInterlocking,
  tokenCovered,
  maskComments,
  lineOf,
  STATION_MASTER,
  PROD_INTERLOCKING,
  PROD_TRAIN,
  rel,
  mk,
  writeReport,
} from "../_shared/interlocking.mjs";

const RULE = "tester.bun.interlocking-smoke-coverage-for-station-master";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
const violations = [];

function actionSmokeCovered(action, e2eTexts) {
  return e2eTexts.some(
    (t) =>
      tokenCovered(action, t) && STATION_MASTER.test(t) && t.includes(PROD_INTERLOCKING) && t.includes(PROD_TRAIN),
  );
}

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    const records = interlockingFiles(croot)
      .map((f) => ({ file: f, rec: parseInterlocking(readText(f)) }))
      .filter((x) => x.rec);
    const e2eTexts = e2eFiles(croot).map((f) => maskComments(readText(f)));

    for (const { file, rec } of records) {
      if (!rec.exposed) continue;
      for (const action of rec.actions) {
        if (actionSmokeCovered(action, e2eTexts)) continue;
        const [line, src] = lineOf(rec.rawText, new RegExp("^\\s*-\\s*['\"]?" + action + "['\"]?\\s*$"));
        violations.push(
          mk(
            RULE,
            rel(file, croot),
            line,
            0,
            `exposed Station Master action "${action}" of interlocking "${rec.interlockingId}" has no smoke ` +
              `test reaching the Station Master and driving InterlockingRunner -> TrainRunner; add an e2e smoke ` +
              `test (strict: exposed actions are critical user-facing routes)`,
            src.trim(),
          ),
        );
      }
    }
  }
}

writeReport(violations);
