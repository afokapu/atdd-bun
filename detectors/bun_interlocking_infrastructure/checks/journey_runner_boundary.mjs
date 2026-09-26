#!/usr/bin/env bun
// Check: coder.bun.journey-runner-boundary (disposition: strict)
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  parseJsonEnv,
  readText,
  findConsumerRoots,
  appFile,
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
  PLAN_ROOT,
} from "../_shared/interlocking.mjs";

const RULE = "coder.bun.journey-runner-boundary";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
const violations = [];

function hasJourneyTopology(root) {
  const base = join(root, PLAN_ROOT, "_journeys");
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

function loadsJourneyDeclaration(text) {
  const masked = maskComments(text);
  const readsJourneyPath =
    /Bun\.file\s*\(\s*[^)]*(?:journey|_journeys)/i.test(masked) ||
    /\breadFile(?:Sync)?\s*\(\s*[^,)]*(?:journey|_journeys)/i.test(masked);
  const parsesDeclaration = /Bun\.YAML\.parse\s*\(|JSON\.parse\s*\(/.test(masked);
  return readsJourneyPath && parsesDeclaration;
}

function hiddenTopologyLiterals(text) {
  const masked = maskComments(text);
  const hits = [];
  const re = /(["'`])((?:plan\/_trains\/_interlockings\/[a-z][a-z0-9-]*\.ya?ml)|(?:interlocking:[a-z][a-z0-9-]+))\1/g;
  let match;
  while ((match = re.exec(masked)) !== null) {
    const line = lineOfIndex(masked, match.index);
    hits.push({ line, value: match[2], src: lineAt(text, line) });
  }
  return hits;
}

function hardcodedInterlockingConstruction(text) {
  const masked = maskComments(text);
  const hits = [];
  const re = /new\s+InterlockingRunner\s*\(\s*(["'`])([^"'`]+)\1/g;
  let match;
  while ((match = re.exec(masked)) !== null) {
    const line = lineOfIndex(masked, match.index);
    hits.push({ line, value: match[2], src: lineAt(text, line) });
  }
  return hits;
}

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    if (!hasJourneyTopology(croot)) continue;
    const modules = runtimeFiles(croot)
      .map(file => ({ file, text: readText(file) }))
      .filter(item => /\bclass\s+JourneyRunner\b/.test(maskComments(item.text)));

    if (modules.length === 0) {
      // As interlocking-runner-exists: the runner is owed once a Station Master exists to call it, not before.
      if (!appFile(croot)) continue;
      violations.push(mk(
        RULE,
        `${PLAN_ROOT}/_journeys`,
        1,
        0,
        "missing-journey-runner: journey topology is declared but no JourneyRunner class exists under src/trains/",
        "",
      ));
      continue;
    }

    const runtimeSurface = runtimeFiles(croot).map(readText).join("\n");
    const loadsDeclaration = loadsJourneyDeclaration(runtimeSurface);

    for (const { file, text } of modules) {
      const line = journeyRunnerLine(text);
      if (!loadsDeclaration) violations.push(mk(
        RULE,
        rel(file, croot),
        line,
        0,
        "journey-runtime-transcription: JourneyRunner does not read and parse a journey declaration; topology may be hardcoded",
        lineAt(text, line),
      ));
      for (const hit of hardcodedInterlockingConstruction(text)) violations.push(mk(
        RULE,
        rel(file, croot),
        hit.line,
        0,
        "journey-runtime-hidden-topology: JourneyRunner constructs InterlockingRunner from literal " + hit.value + " instead of declared continuation data",
        hit.src,
      ));
      for (const hit of hiddenTopologyLiterals(text)) violations.push(mk(
        RULE,
        rel(file, croot),
        hit.line,
        0,
        "journey-runtime-hidden-topology: JourneyRunner contains static topology literal " + hit.value + " instead of deriving it from the journey declaration",
        hit.src,
      ));
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
