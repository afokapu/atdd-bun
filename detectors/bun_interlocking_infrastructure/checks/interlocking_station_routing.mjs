#!/usr/bin/env bun
// Check: coder.bun.station-master-interlocking-routing  (disposition: strict)
//
// When the Station Master composition root (server.ts) declares an interlocking route object in
// its JOURNEY_MAP, it MUST reference `InterlockingRunner` (else unlinked) and `TrainRunner` (else no
// delegation). Bun mirror of core coder.train.station-master-interlocking-routing (#1251).
import {
  parseJsonEnv,
  readText,
  findConsumerRoots,
  appFile,
  journeyMap,
  referencesToken,
  rel,
  lineAt,
  mk,
  writeReport,
} from "../_shared/interlocking.mjs";

const RULE = "coder.bun.station-master-interlocking-routing";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);

function dispatchDelegatesThroughInterlocking(text) {
  const match = /\b(?:export\s+)?function\s+dispatch\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/.exec(text);
  if (!match) return false;
  const body = match[1];
  if (/\breturn\s+new\s+InterlockingRunner\s*\([^)]*\)\s*\.\s*execute\s*\(/.test(body)) return true;
  const runner = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+InterlockingRunner\s*\(/.exec(body)?.[1];
  return Boolean(runner && new RegExp(`\\breturn\\s+(?:await\\s+)?${runner}\\s*\\.\\s*execute\\s*\\(`).test(body));
}
const violations = [];

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    const app = appFile(croot);
    if (!app) continue;
    const text = readText(app);
    const jm = journeyMap(text);
    if (!jm.hasInterlocking) continue; // pure direct-train Station Master carries no obligation.

    const line = jm.interlockingLine || 1;
    if (!referencesToken(text, "InterlockingRunner")) {
      violations.push(
        mk(
          RULE,
          rel(app, croot),
          line,
          0,
          "station-master-unlinked: Station Master declares an interlocking route but never " +
            "references InterlockingRunner",
          lineAt(text, line),
        ),
      );
    }
    if (!referencesToken(text, "TrainRunner")) {
      violations.push(
        mk(
          RULE,
          rel(app, croot),
          line,
          0,
          "station-master-no-trainrunner-delegation: Station Master never references TrainRunner; " +
            "the selected train must be executed by TrainRunner",
          lineAt(text, line),
        ),
      );
    }
    if (!dispatchDelegatesThroughInterlocking(text)) {
      violations.push(mk(
        RULE,
        rel(app, croot),
        line,
        0,
        "station-master-dispatch-bypasses-runners: mapped interlocking dispatch must return InterlockingRunner execution; inert runner references or direct business data do not execute the selected train",
        lineAt(text, line),
      ));
    }
  }
}

writeReport(violations);
