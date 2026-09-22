#!/usr/bin/env bun
// Check: coder.bun.interlocking-delegates-to-trainrunner  (disposition: strict)
//
// An InterlockingRunner-defining module MUST NOT execute wagons directly or duplicate the TrainRunner
// step loop: no wagon-module import, no `runTrain(...)` call, no `for (... of <expr>.sequence)`
// executor loop. TrainRunner remains the only wagon-step executor. Bun mirror of core
// coder.train.interlocking-delegates-to-trainrunner (#1251). Only runner-defining modules are scanned;
// the production TrainRunner module's own loop is legitimate and not flagged.
import {
  parseJsonEnv,
  findConsumerRoots,
  runnerModules,
  importsWagon,
  runTrainCalls,
  sequenceLoops,
  rel,
  mk,
  writeReport,
} from "../_shared/interlocking.mjs";

const RULE = "coder.bun.interlocking-delegates-to-trainrunner";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
const violations = [];

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    for (const { file, text } of runnerModules(croot)) {
      const r = rel(file, croot);
      for (const hit of importsWagon(text)) {
        violations.push(
          mk(
            RULE,
            r,
            hit.line,
            0,
            "interlocking-direct-wagon-execution: interlocking module imports a wagon module directly",
            hit.src,
          ),
        );
      }
      for (const hit of runTrainCalls(text)) {
        violations.push(
          mk(
            RULE,
            r,
            hit.line,
            0,
            "interlocking-direct-wagon-execution: interlocking module calls runTrain(...) directly",
            hit.src,
          ),
        );
      }
      for (const hit of sequenceLoops(text)) {
        violations.push(
          mk(
            RULE,
            r,
            hit.line,
            0,
            "interlocking-direct-wagon-execution: interlocking module loops over train.sequence as a " +
              "step executor",
            hit.src,
          ),
        );
      }
    }
  }
}

writeReport(violations);
