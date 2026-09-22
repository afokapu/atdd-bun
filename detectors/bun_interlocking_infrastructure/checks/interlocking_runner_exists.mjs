#!/usr/bin/env bun
// Check: coder.bun.interlocking-runner-exists  (disposition: strict)
//
// A consumer whose Station Master JOURNEY_MAP declares an interlocking route MUST ship an
// `InterlockingRunner` route-control layer under src/trains/**, exposing a `resolveTrain(...)`
// entry point (Bun mirror of core coder.train.interlocking-runner-exists / afokapu/atdd#1251).
// A pure direct-train consumer carries no obligation.
import {
  parseJsonEnv,
  readText,
  findConsumerRoots,
  runtimeFiles,
  appFile,
  journeyMap,
  hasRunnerClass,
  hasResolveTrain,
  runnerClassLine,
  rel,
  lineAt,
  mk,
  writeReport,
} from "../_shared/interlocking.mjs";

const RULE = "coder.bun.interlocking-runner-exists";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
const violations = [];

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    const app = appFile(croot);
    const appText = app ? readText(app) : "";
    const jm = journeyMap(appText);
    const runnerFiles = runtimeFiles(croot)
      .map((f) => ({ file: f, text: readText(f) }))
      .filter((x) => hasRunnerClass(x.text));

    const enabled = jm.hasInterlocking || runnerFiles.length > 0;
    if (!enabled) continue;

    if (jm.hasInterlocking && runnerFiles.length === 0 && app) {
      const line = jm.interlockingLine || 1;
      violations.push(
        mk(
          RULE,
          rel(app, croot),
          line,
          0,
          "missing-interlocking-runner: JOURNEY_MAP declares an interlocking route but no " +
            "InterlockingRunner class exists under src/trains/ (core afokapu/atdd#1251)",
          lineAt(appText, line),
        ),
      );
    }

    for (const { file, text } of runnerFiles) {
      if (!hasResolveTrain(text)) {
        const line = runnerClassLine(text);
        violations.push(
          mk(
            RULE,
            rel(file, croot),
            line,
            0,
            "missing-resolve-train: InterlockingRunner has no resolveTrain(...) entry point",
            lineAt(text, line),
          ),
        );
      }
    }
  }
}

writeReport(violations);
