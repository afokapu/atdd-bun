#!/usr/bin/env bun
// Member check: coder.bun.logging-structured  (security/hygiene family)
//
// RE-REALIZED. The python-pytest sibling finds `logger.info("...")` calls whose
// only argument is a bare string — a log line carrying no queryable context. The
// receiver names and log methods carry over; the argument shape does not, because
// a JS logger takes a context OBJECT (`logger.info("msg", { orderId })`) where the
// Python one takes `extra=`/kwargs.
//
// The obligation: a log line must carry structured context, or it cannot be
// searched when it matters — which is at 3am, by someone who did not write it.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT } from "../../../lib/scan.mjs";

const RULE = "coder.bun.logging-structured";

// LOGGER_RECEIVER_NAMES + LOG_METHODS, transcribed from structured_logging.py and
// widened with the JS-idiomatic `warn`/`trace`.
const BARE_LOG_RE =
  /\b(logger|log|_logger|_log|LOG)\s*\.\s*(debug|info|warn|warning|error|critical|exception|trace|log)\s*\(\s*(['"`])((?:[^'"`\\]|\\.)*)\3\s*\)/g;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const text = readText(file);
    if (!text) continue;
    for (const m of text.matchAll(BARE_LOG_RE)) {
      violations.push({
        rule_id: RULE, file, ...locate(text, m.index),
        evidence: `${m[1]}.${m[2]} logs a bare string with no context object; add the fields this line would be searched by`,
      });
    }
  }
}
process.stderr.write(`bun-security[logging-structured]: ${violations.length} violation(s)\n`);
emit(violations);
