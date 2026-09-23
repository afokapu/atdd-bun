#!/usr/bin/env bun
// Detector: coder.bun.design-tokens-pure
// Files in the tokens/foundations layer hold values only: no JSX runtime import,
// no rendered markup, no control flow.
import { readRoots, readExcludes, readText, emit, locate } from "../../../lib/scan.mjs";
import { extname } from "node:path";
import { scope, designOf, importsOf, masked, CODE_EXT } from "./_design.mjs";

const RULE_ID = "coder.bun.design-tokens-pure";
const RENDERERS = /^(react|react-dom|preact|hono\/jsx|hono\/jsx\/.*|@kitajs\/html)$/;
const violations = [];
const report = (file, text, index, evidence) => violations.push({ rule_id: RULE_ID, file, ...locate(text, index), evidence });
for (const file of scope(readRoots(), readExcludes())) {
  if (designOf(file)?.layer !== 0 || !CODE_EXT.has(extname(file))) continue;
  const m = masked(file);
  if (!m) continue;
  for (const imp of importsOf(m.text)) if (RENDERERS.test(imp.specifier)) report(file, m.text, imp.index, `token file imports the renderer "${imp.specifier}"; tokens are values, not widgets`);
  const jsx = m.code.search(/<\/[A-Za-z]|\/>/);
  if (jsx !== -1) report(file, m.text, jsx, "token file renders markup; move it to primitives");
  for (const c of m.code.matchAll(/\b(if|for|while|switch)\s*\(/g)) report(file, m.text, c.index, `token file branches with ${c[1]}; tokens are pure values`);
}
process.stderr.write(`bun-detector[design-tokens-pure]: ${violations.length} violation(s)\n`);
emit(violations);
