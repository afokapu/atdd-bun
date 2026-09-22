#!/usr/bin/env bun
// Check: coder.bun.journey-runner-boundary (disposition: strict)
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  parseJsonEnv,
  readText,
  findConsumerRoots,
  runtimeFiles,
  referencesToken,
  importsWagon,
  runTrainCalls,
  sequenceLoops,
  cargoUses,
  rel,
  lineOfIndex,
  lineAt,
  mk,
  writeReport,
  maskComments,
} from "../_shared/interlocking.mjs";

const RULE = "coder.bun.journey-runner-boundary";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
const violations = [];

function hasJourneyTopology(root) {
  const base = join(root, "plan", "_journeys");
  if (!existsSync(base)) return false;
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const st = statSync(path);
      if (st.isDirectory()) stack.push(path);
      else if (/\.ya?ml$/.test(name)) return true;
    }
  }
  return false;
}

function journeyRunnerLine(text) {
  const match = /\bclass\s+JourneyRunner\b/.exec(maskComments(text));
  return match ? lineOfIndex(text, match.index) : 1;
}

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    if (!hasJourneyTopology(croot)) continue;
    const modules = runtimeFiles(croot)
      .map(file => ({ file, text: readText(file) }))
      .filter(item => /\bclass\s+JourneyRunner\b/.test(maskComments(item.text)));

    if (modules.length === 0) {
      violations.push(mk(
        RULE,
        "plan/_journeys",
        1,
        0,
        "missing-journey-runner: journey topology is declared but no JourneyRunner class exists under src/trains/",
        "",
      ));
      continue;
    }

    for (const { file, text } of modules) {
      const line = journeyRunnerLine(text);
      if (!referencesToken(text, "InterlockingRunner")) violations.push(mk(
        RULE,
        rel(file, croot),
        line,
        0,
        "journey-runner-bypasses-interlocking: JourneyRunner must delegate routing decisions to InterlockingRunner",
        lineAt(text, line),
      ));
      if (referencesToken(text, "TrainRunner")) violations.push(mk(
        RULE,
        rel(file, croot),
        line,
        0,
        "journey-runner-executes-train: JourneyRunner references TrainRunner directly; train execution belongs behind InterlockingRunner",
        lineAt(text, line),
      ));
      for (const hit of importsWagon(text)) violations.push(mk(RULE, rel(file, croot), hit.line, 0, "journey-runner-executes-wagon: JourneyRunner imports a wagon module", hit.src));
      for (const hit of runTrainCalls(text)) violations.push(mk(RULE, rel(file, croot), hit.line, 0, "journey-runner-executes-wagon: JourneyRunner calls runTrain(...) directly", hit.src));
      for (const hit of sequenceLoops(text)) violations.push(mk(RULE, rel(file, croot), hit.line, 0, "journey-runner-executes-sequence: JourneyRunner loops over train.sequence", hit.src));
      for (const hit of cargoUses(text)) violations.push(mk(RULE, rel(file, croot), hit.line, 0, "journey-runner-carries-cargo: JourneyRunner " + hit.detail, hit.src));
    }
  }
}

writeReport(violations);
