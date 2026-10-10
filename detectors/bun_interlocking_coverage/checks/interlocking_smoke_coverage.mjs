#!/usr/bin/env bun
// Check: tester.bun.interlocking-smoke-coverage-for-station-master  (disposition: strict, severity 1)
//
// Every EXPOSED Station Master action of an interlocking (entrypoint.exposed:true with an actions
// entry, core afokapu/atdd#1248) MUST have a smoke test that drives the action through the real
// entrypoint -> Station Master -> InterlockingRunner -> TrainRunner path (#1251). Internal
// (exposed:false) interlockings have no Station Master action and are OUT OF SCOPE. Bun mirror of
// core tester.interlocking.smoke-coverage-for-station-master. The enforced minimum smoke signature is
// an `e2e/**/*.ts` file referencing the action name AND a Station Master reference AND both runners.
import { join } from "node:path";
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
  stationMasterExecutionProof,
  stationModuleExecutionProof,
  rel,
  mk,
  writeReport,
} from "../_shared/interlocking.mjs";

const RULE = "tester.bun.interlocking-smoke-coverage-for-station-master";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
const violations = [];

// Only a smoke test counts: one whose header declares `Phase: SMOKE` (tester.bun.test-phase-declared), which also puts
// it under the smoke rules (no substituted collaborators, observable outcome). A local E2E that names the action beside
// the runners is not a smoke and no longer clears the rule (FWS #TzSCGS5ajYhP).
const SMOKE_PHASE = /^\s*\/\/\s*Phase:\s*SMOKE\b/m;
function actionSmokeCovered(action, e2eFiles, station, croot) {
  return e2eFiles.some(
    ({ raw, text: t, file }) =>
      SMOKE_PHASE.test(raw) && tokenCovered(action, t) && STATION_MASTER.test(t) &&
        (stationMasterExecutionProof(t, action) ||
          (station && stationModuleExecutionProof(t, station.text, action, station.file, croot))),
  );
}

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    const records = interlockingFiles(croot)
      .map((f) => ({ file: f, rec: parseInterlocking(readText(f)) }))
      .filter((x) => x.rec);
    const e2eTexts = e2eFiles(croot).map((file) => { const raw = readText(file); return { file, raw, text: maskComments(raw) }; });
    const station = ["server.ts", "src/server.ts"]
      .map((name) => ({ file: join(croot, name), text: readText(join(croot, name)) }))
      .find((entry) => entry.text);

    for (const { file, rec } of records) {
      if (!rec.exposed) continue;
      for (const action of rec.actions) {
        if (actionSmokeCovered(action, e2eTexts, station, croot)) continue;
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
