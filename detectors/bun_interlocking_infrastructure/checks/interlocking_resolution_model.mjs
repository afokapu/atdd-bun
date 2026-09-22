#!/usr/bin/env bun
// Check: coder.bun.interlocking-resolution-model-exists  (disposition: strict)
//
// When an InterlockingRunner exposes `resolveTrain(...)`, it MUST resolve a structured
// `InterlockingResolution` model carrying the route metadata — not a bare `trainId` string. The
// model MUST define interlockingId, routeId, trainId, trainPath, category, guardId, resolutionStrategy,
// reason (Bun mirror of core coder.train.interlocking-resolution-model-exists / #1251).
import {
  parseJsonEnv,
  readText,
  findConsumerRoots,
  runtimeFiles,
  hasRunnerClass,
  hasResolveTrain,
  resolutionModelFields,
  runnerClassLine,
  REQUIRED_RESOLUTION_FIELDS,
  rel,
  lineAt,
  mk,
  writeReport,
} from "../_shared/interlocking.mjs";

const RULE = "coder.bun.interlocking-resolution-model-exists";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
const violations = [];

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    const files = runtimeFiles(croot).map((f) => ({ file: f, text: readText(f) }));
    const runnerFiles = files.filter((x) => hasRunnerClass(x.text));
    if (runnerFiles.length === 0) continue; // resolution-model is a runner concern only.

    const hasResolve = runnerFiles.some((x) => hasResolveTrain(x.text));
    if (!hasResolve) continue; // missing resolveTrain is the runner-exists concern.

    // Merge resolution-model fields across the runtime (model may live in a sibling module).
    let fields = null;
    for (const { text } of files) {
      const f = resolutionModelFields(text);
      if (f !== null) fields = fields ? new Set([...fields, ...f]) : f;
    }

    const missing = REQUIRED_RESOLUTION_FIELDS.filter((k) => !(fields && fields.has(k)));
    if (missing.length > 0) {
      const target = runnerFiles[0];
      const line = runnerClassLine(target.text);
      violations.push(
        mk(
          RULE,
          rel(target.file, croot),
          line,
          0,
          "bare-train-id-resolution: resolveTrain resolves a bare trainId; a structured " +
            "InterlockingResolution model is missing required field(s): " +
            missing.join(", "),
          lineAt(target.text, line),
        ),
      );
    }
  }
}

writeReport(violations);
