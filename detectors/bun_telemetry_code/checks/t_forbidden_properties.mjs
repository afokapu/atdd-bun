#!/usr/bin/env bun
// Member check: coder.bun.telemetry-forbidden-properties  (telemetry code family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT } from "../../../lib/scan.mjs";
import { registry, normalizeName } from "../registry.mjs";
import { maskComments, emitStringCalls, objectLiteralAt, topLevelKeys } from "../calls.mjs";

// The tracking plan's forbidden_properties list (raw payloads, secrets, prompts) is a
// promise about what NEVER leaves the process on that item. When an emit-like call
// names a declared item, the object literal it passes is checked against that list —
// snake_case in the plan meets camelCase in code through normalization.
const RULE = "coder.bun.telemetry-forbidden-properties";

const { adopted, forbidden } = await registry();
const violations = [];
if (adopted) {
  const excludes = readExcludes();
  for (const root of readRoots()) {
    for (const file of walk(root, excludes, SOURCE_EXT)) {
      const text = readText(file);
      if (!text) continue;
      const masked = maskComments(text);
      for (const call of emitStringCalls(masked)) {
        const banned = forbidden.get(call.value);
        if (!banned) continue;
        // From the end of the first argument, skip the separator and read the properties object.
        let i = call.argEnd;
        while (i < masked.length && /\s/.test(masked[i])) i++;
        if (masked[i] !== ",") continue;
        i++;
        while (i < masked.length && /\s/.test(masked[i])) i++;
        const objectText = objectLiteralAt(masked, i);
        if (!objectText) continue;
        for (const key of topLevelKeys(objectText)) {
          if (!banned.has(normalizeName(key))) continue;
          violations.push({ rule_id: RULE, file, ...locate(text, call.index),
            evidence: `passes forbidden property '${key}' to ${call.value}; the tracking plan forbids it on this item` });
        }
      }
    }
  }
}
process.stderr.write(`bun-telemetry[forbidden-properties]: ${violations.length} violation(s)\n`);
emit(violations);
