#!/usr/bin/env bun
// Check: coder.bun.interlocking-does-not-carry-cargo  (disposition: strict)
//
// Cargo is the artifact data plane carried by TrainRunner between wagons inside a selected train. An
// InterlockingRunner-defining module MUST NOT reference/mutate Cargo or store an artifact_urn value,
// and wagons MUST NOT import interlocking code. Bun mirror of core
// coder.train.interlocking-does-not-carry-cargo (#1251). The production TrainRunner legitimately
// carries Cargo and is not scanned here (only InterlockingRunner-defining modules + wagons are).
import {
  parseJsonEnv,
  readText,
  findConsumerRoots,
  runnerModules,
  wagonFiles,
  cargoUses,
  importsInterlocking,
  rel,
  mk,
  writeReport,
} from "../_shared/interlocking.mjs";

const RULE = "coder.bun.interlocking-does-not-carry-cargo";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
const violations = [];

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    for (const { file, text } of runnerModules(croot)) {
      const r = rel(file, croot);
      for (const hit of cargoUses(text)) {
        violations.push(
          mk(
            RULE,
            r,
            hit.line,
            0,
            "interlocking-cargo-mutation: interlocking module " + hit.detail,
            hit.src,
          ),
        );
      }
    }
    for (const f of wagonFiles(croot)) {
      const text = readText(f);
      for (const hit of importsInterlocking(text)) {
        violations.push(
          mk(
            RULE,
            rel(f, croot),
            hit.line,
            0,
            "wagon-imports-interlocking: wagon module imports interlocking code (Cargo boundary " +
              "violation)",
            hit.src,
          ),
        );
      }
    }
  }
}

writeReport(violations);
