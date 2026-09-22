#!/usr/bin/env bun
// Member check: coder.bun.dto-purity  (clean-architecture family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { walk, readRoots, readExcludes, readText, emit, locate, maskLiteralsAndComments, SOURCE_EXT } from "../../../lib/scan.mjs";
import { allImportSpecifiers, layerOf, resolveSpecifier } from "../../../lib/imports.mjs";
import { basename } from "node:path";

// Mirrors coder.convex.dto-purity. A `*DTO` type is pure, immutable data: no method
// members, every field `readonly`.
const RULE = "coder.bun.dto-purity";
const DTO_DECL = /\b(?:type|interface)\s+([A-Za-z0-9_]*DTO)\b/g;

// The declaration body: `{ … }` following the name.
function bodyOf(text, from) {
  const open = text.indexOf("{", from);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return text.slice(open, i + 1); }
  }
  return "";
}

// Members are split on `;` and newlines rather than matched with a line-anchored
// regex: a DTO written on ONE line (`{ id: string; total(): number }`) is legal
// TypeScript, and anchoring to line start silently missed every member but the
// first — the detector reported the field fault and not the method one.
const METHOD_MEMBER = /^[A-Za-z0-9_]+\s*\([^)]*\)\s*:/;
const MUTABLE_FIELD = /^(?!readonly\b)[A-Za-z0-9_]+\??\s*:/;

function members(inner) {
  return inner.split(/[;\n,]/).map((x) => x.trim()).filter(Boolean);
}

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const text = readText(file);
    if (!text) continue;
    for (const m of text.matchAll(DTO_DECL)) {
      const body = bodyOf(text, m.index + m[0].length);
      if (!body) continue;
      const inner = body.slice(1, -1);
      const parts = members(inner);
      const faults = [];
      if (parts.some((x) => METHOD_MEMBER.test(x))) faults.push("a method member");
      if (parts.some((x) => MUTABLE_FIELD.test(x))) faults.push("a non-readonly field");
      if (!faults.length) continue;
      violations.push({ rule_id: RULE, file, ...locate(text, m.index),
        evidence: `${m[1]} has ${faults.join(" and ")}; a DTO is pure, immutable data` });
    }
  }
}
process.stderr.write(`bun-arch[dto-purity]: ${violations.length} violation(s)\n`);
emit(violations);
