#!/usr/bin/env bun
// Member check: coder.bun.duplication-intra-layer  (TypeScript metrics family)
//
// Cross-file: fingerprints every sliding window of 7 non-trivial NORMALIZED lines
// and reports a window that appears in two DIFFERENT files of the SAME
// architectural layer. Normalization (comments stripped, string literals folded to
// "S", numbers to 0, non-keyword identifiers to ID) is transcribed from the Python
// sibling, so renaming a variable does not hide a duplicate.
//
// Intra-layer only: the same shape appearing in `domain/` and in `presentation/`
// is usually two different obligations that happen to look alike, whereas twice in
// one layer is the shape that should have been extracted.
import { walk, readRoots, readExcludes, readText, emit } from "../../../lib/scan.mjs";
import * as M from "../ts_metrics.mjs";
import { createHash } from "node:crypto";
import { basename, sep } from "node:path";

const RULE = "coder.bun.duplication-intra-layer";
// sha256 hex truncated to 16 — the Python sibling's fingerprint, verbatim.
const hasher = (block) => createHash("sha256").update(block, "utf8").digest("hex").slice(0, 16);

const isExcluded = (f) =>
  /\.(test|spec)\.tsx?$/.test(f) || f.endsWith(".d.ts") ||
  basename(f) === "index.ts" || f.split(sep).includes("__tests__");

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  const byLayer = new Map();
  for (const f of walk(root, excludes, M.TS_EXT, true)) {
    if (isExcluded(f)) continue;
    const layer = M.determineLayer(f);
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(f);
  }

  for (const [layer, files] of byLayer) {
    if (files.length < 2) continue;
    // walk() yields whatever order the filesystem hands back, and the pair is
    // reported as "the duplicate at `other`, whose original is `first`" — so an
    // unsorted walk decides which of the two files gets named. It reported a.ts
    // on macOS and b.ts on ubuntu for the very same fixture. Sorting fixes the
    // roles: the earliest path is the original, the rest are the duplicates.
    // The three python detectors already sort their walks; this port dropped it.
    files.sort();
    const hashMap = new Map();
    for (const f of files) {
      const text = readText(f);
      if (!text) continue;
      for (const fr of M.fragments(text, M.DUP_MIN_LINES, hasher)) {
        if (!hashMap.has(fr.hash)) hashMap.set(fr.hash, []);
        hashMap.get(fr.hash).push({ file: f, start: fr.start });
      }
    }
    for (const locations of hashMap.values()) {
      if (new Set(locations.map((l) => l.file)).size < 2) continue;
      const first = locations[0];
      for (const other of locations.slice(1)) {
        if (other.file === first.file) continue;
        violations.push({
          rule_id: RULE, file: other.file, line: other.start, col: 0,
          evidence: `${M.DUP_MIN_LINES} duplicated lines in layer '${layer}', also at ${basename(first.file)}:${first.start}`,
          source_line: "",
        });
      }
    }
  }
}
process.stderr.write(`bun-metrics[duplication]: ${violations.length} violation(s)\n`);
emit(violations);
