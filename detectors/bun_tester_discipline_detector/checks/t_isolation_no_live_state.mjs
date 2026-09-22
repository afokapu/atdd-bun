#!/usr/bin/env bun
// Member check: tester.bun.test-isolation-no-live-state  (tester discipline family)
//
// A test must not write to state the developer or CI shares. Core's sibling
// (`tester.test-isolation.no-polluting-patterns`) detects Python bare-mode-init
// patterns; the Bun shapes are different, so this is a re-realization: mutating
// `process.env` at module scope, and filesystem writes to a path that is not
// derived from a temp directory or the test's own directory.
//
// This is the `strict` rule of the family, matching core, because a polluting test
// does not fail loudly — it makes a DIFFERENT test fail later, somewhere else, and
// costs a day to trace.
import { runCheck } from "../test_header.mjs";

const RULE = "tester.bun.test-isolation-no-live-state";
const ENV_MUTATION = /^\s*process\.env\s*\.\s*[A-Za-z_][\w]*\s*=(?!=)/;
const FS_WRITE = /\b(?:writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|rmdirSync|cpSync|renameSync)\s*\(\s*(['"`])([^'"`]*)\1/g;
// A path that is scoped to the test: a temp dir, the test's own directory, or an
// obviously disposable fixture root.
const SCOPED = /tmpdir|tmp\/|\/tmp|import\.meta\.dir|__fixtures__|\.tmp/i;

runCheck(RULE, (H, file, text) => {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (ENV_MUTATION.test(line)) {
      out.push({ line: i + 1,
        evidence: "test mutates process.env, leaking configuration into every test that runs after it",
        source_line: line.trim() });
    }
    FS_WRITE.lastIndex = 0;
    let m;
    while ((m = FS_WRITE.exec(line)) !== null) {
      if (SCOPED.test(m[2])) continue;
      out.push({ line: i + 1,
        evidence: `test writes to the literal path "${m[2]}" outside a temp directory; scope it to tmpdir() or import.meta.dir`,
        source_line: line.trim() });
    }
  });
  return out;
});
