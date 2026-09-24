#!/usr/bin/env bun
// Member check: coder.bun.telemetry-source-binding  (telemetry code family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { walk, readRoots, readExcludes, readText, emit } from "../../../lib/scan.mjs";
import { registry } from "../registry.mjs";

// A source file binds itself to the tracking plan with a Telemetry: header naming the
// concrete item it emits. This is the source-to-telemetry traceability edge: every URN
// so written must be a well-formed concrete URN that resolves to a registry entry.
const RULE = "coder.bun.telemetry-source-binding";
const TELEMETRY_HEADER = /^[ \t]*\/\/[ \t]*Telemetry:[ \t]*(\S+)[ \t]*$/;
const STRING_ON_LINE = /(["'`])(?:\\.|(?!\1)[^\n\\])*\1/g;

const { adopted, ids, concreteUrn } = await registry();
const violations = [];
if (adopted) {
  const excludes = readExcludes();
  for (const root of readRoots()) {
    for (const file of walk(root, excludes, new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]))) {
      const text = readText(file);
      if (!text) continue;
      let offset = 0;
      for (const raw of text.split("\n")) {
        // A header inside a string literal is not a header: strip literals before judging the line.
        const match = TELEMETRY_HEADER.exec(raw.replace(STRING_ON_LINE, '""'));
        if (match) {
          const at = offset + match.index;
          const before = text.slice(0, at);
          if (!concreteUrn.test(match[1])) {
            violations.push({ rule_id: RULE, file, line: before.split("\n").length, col: at - before.lastIndexOf("\n"),
              evidence: `${match[1]} is not a concrete telemetry URN telemetry:{kind}:{plane}:{theme}:{artifact}[:{measure}]`,
              source_line: raw.trim() });
          } else if (!ids.has(match[1])) {
            violations.push({ rule_id: RULE, file, line: before.split("\n").length, col: at - before.lastIndexOf("\n"),
              evidence: `${match[1]} does not resolve to a tracking-plan item under telemetry/`,
              source_line: raw.trim() });
          }
        }
        offset += raw.length + 1;
      }
    }
  }
}
process.stderr.write(`bun-telemetry[source-binding]: ${violations.length} violation(s)\n`);
emit(violations);
