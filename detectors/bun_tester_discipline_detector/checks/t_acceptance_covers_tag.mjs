#!/usr/bin/env bun
// Member check: tester.bun.acceptance-covers-tag-well-formed  (tester discipline family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} violations to ATDD_VIOLATIONS_REPORT,
// exits 0 regardless of violation count. Scans TEST FILES ONLY — source files are
// the coder extension's business. Shared parsing lives in ../test_header.mjs.
import { runCheck } from "../test_header.mjs";

import { testCases } from "../test_header.mjs";

runCheck("tester.bun.acceptance-covers-tag-well-formed", (H, file, text) => {
  const out = [];
  for (const c of testCases(text)) {
    for (const tag of c.covers) {
      // The two-level model (#1783): a file header binds the FILE, a @covers tag
      // binds one `it()`. A malformed tag binds nothing while looking like it does.
      if (/^acc:[a-z][a-z0-9-]*:[A-Za-z0-9-]+$/.test(tag)) continue;
      out.push({ line: c.line,
        evidence: `@covers tag "${tag}" is not a well-formed acc:{wagon}:{ACCEPTANCE-ID} URN`,
        source_line: c.text });
    }
  }
  return out;
});
