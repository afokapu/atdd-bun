#!/usr/bin/env bun
// Member check: coder.bun.security-sql-injection  (security/hygiene family)
//
// RE-REALIZED, NOT PORTED. The python-pytest sibling walks a Python AST for
// `execute` / `executemany` / `raw` / `execute_sql` calls — its own manifest says
// "SCOPE: python stack only". None of those sinks exist here. Bun's SQL surface is
// `Bun.sql`, `bun:sqlite` (`db.query` / `db.run` / `db.exec` / `db.prepare`) and
// the postgres/mysql clients, and the injection shape is a TEMPLATE LITERAL with
// `${}` interpolation reaching one of them.
//
// The obligation is identical — never build SQL by concatenating untrusted data.
// The detector could not be more different, which is exactly why a stack extension
// is a package and not a translation.
//
// NOTE the one genuine subtlety: Bun's `Bun.sql` tagged template is SAFE by
// construction — `sql`SELECT ... WHERE id = ${id}`` parameterises the value rather
// than splicing it. So a tagged template is never flagged; only a template literal
// passed as an ARGUMENT to a sink, where no parameterisation happens.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT } from "../../../lib/scan.mjs";

const RULE = "coder.bun.security-sql-injection";

const SQL_KEYWORDS = /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i;
// A sink call whose first argument opens a template literal: `db.query(`...`)`.
const SINK_TEMPLATE_RE =
  /\b(?:query|run|exec|execute|prepare|unsafe)\s*\(\s*`([^`]*)`/g;
// String concatenation into a sink: `db.query("SELECT ... " + userInput)`.
const SINK_CONCAT_RE =
  /\b(?:query|run|exec|execute|prepare|unsafe)\s*\(\s*(['"])([^'"]*)\1\s*\+/g;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const text = readText(file);
    if (!text) continue;

    for (const m of text.matchAll(SINK_TEMPLATE_RE)) {
      const body = m[1];
      if (!SQL_KEYWORDS.test(body) || !body.includes("${")) continue;
      violations.push({
        rule_id: RULE, file, ...locate(text, m.index),
        evidence: "SQL built by interpolating into a template literal passed to a query sink; use a parameterised query or the Bun.sql tagged template",
      });
    }
    for (const m of text.matchAll(SINK_CONCAT_RE)) {
      if (!SQL_KEYWORDS.test(m[2])) continue;
      violations.push({
        rule_id: RULE, file, ...locate(text, m.index),
        evidence: "SQL built by string concatenation passed to a query sink; use a parameterised query",
      });
    }
  }
}
process.stderr.write(`bun-security[sql-injection]: ${violations.length} violation(s)\n`);
emit(violations);
