#!/usr/bin/env bun
// Detector: coder.bun.design-orphan-export
// Every component a primitives/components/templates file exports is imported by at
// least one other file: a higher design layer or app code. Re-exports through an
// index.* barrel are not consumption. Dead exports are removed, not kept.
import { readRoots, readExcludes, readText, emit, locate } from "../../../lib/scan.mjs";
import { basename, extname } from "node:path";
import { scope, designOf, importsOf, designTarget, masked, CODE_EXT } from "./_design.mjs";

const RULE_ID = "coder.bun.design-orphan-export";
const files = scope(readRoots(), readExcludes());
const consumed = new Set();
for (const file of files) {
  if (basename(file).startsWith("index.")) continue;
  for (const imp of importsOf(readText(file) ?? "")) {
    if (!designTarget(file, imp.specifier)) continue;
    const named = imp.clause.match(/\{([^}]*)\}/)?.[1] ?? "";
    for (const n of named.split(",")) { const name = n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]; if (name) consumed.add(name); }
    const fallback = imp.clause.replace(/\{[^}]*\}/, "").replace(/\*\s+as\s+\w+/, "").split(",")[0].trim();
    if (/^[A-Z]\w*$/.test(fallback)) consumed.add(fallback);
  }
}
const violations = [];
for (const file of files) {
  const here = designOf(file);
  if (!here || !(here.layer >= 1) || !CODE_EXT.has(extname(file)) || basename(file).startsWith("index.")) continue;
  const m = masked(file);
  for (const e of (m?.code ?? "").matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Z]\w*)/g)) {
    if (!consumed.has(e[1])) violations.push({ rule_id: RULE_ID, file, ...locate(m.text, e.index), evidence: `${here.layerName} export ${e[1]} is imported by no other file` });
  }
}
process.stderr.write(`bun-detector[design-orphan-export]: ${violations.length} violation(s)\n`);
emit(violations);
