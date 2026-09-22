#!/usr/bin/env bun
// Member check: tester.bun.routing-runtime-family  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of count. Scans TEST FILES ONLY.
import { runCheck, testCases, caseBody } from "../test_header.mjs";

// A test file in this stack is collected and executed by `bun test` — a JS/TS
// runtime. So when it DECLARES a `// Runtime:`, that runtime must be in the JS/TS
// family. A test claiming `python` is either mislabelled or filed in the wrong
// suite; either way the gate attributes it to a runner that never ran it.
const JS_FAMILY = new Set(["bun", "browser", "isomorphic", "typescript", "ts",
  "node", "js", "javascript", "deno", "vite", "astro", "preact"]);

runCheck("tester.bun.routing-runtime-family", (H) => {
  if (!H.runtime) return null;   // declaring a runtime is optional for a test
  if (JS_FAMILY.has(H.runtime.value.toLowerCase())) return null;
  return { line: H.runtime.no,
    evidence: `test declares Runtime "${H.runtime.value}", which is not in the JS/TS family this suite executes under`,
    source_line: H.runtime.raw };
});
