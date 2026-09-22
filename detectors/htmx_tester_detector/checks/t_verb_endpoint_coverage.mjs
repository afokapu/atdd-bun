#!/usr/bin/env bun
// Member check: tester.htmx.verb-endpoint-coverage  (htmx tester family)
//
// Mirrors tester.convex.interlocking-route-coverage — "every admissible route
// declared in the guarded route space MUST have at least one end-to-end test that
// exercises it". The declaration source differs and that is the whole adaptation:
// Convex reads `plan/_trains/_interlockings/**/*.yaml`, because a Convex route is
// declared in the plan. An htmx endpoint is declared IN THE MARKUP — `hx-get`,
// `hx-post` — so the markup is this stack's route space.
//
// NO-OP WHEN THERE IS NO SUITE. Given a tree with markup and no test files the
// check emits nothing, mirroring the frontend provider's design-no-op pattern: a
// coverage rule needs both sides, and reporting every endpoint as uncovered
// because the caller scoped the scan to source would be noise, not a finding. It
// also keeps the persona boundary honest — a tester family must not produce
// findings on a source-only tree.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT, TEMPLATE_EXT, TEST_RE } from "../../../lib/scan.mjs";

const RULE = "tester.htmx.verb-endpoint-coverage";
const VERB_ATTR = /\bhx-(?:get|post|put|patch|delete)\s*=\s*(['"])(\/[^'"]*)\1/g;
const EXTS = new Set([...SOURCE_EXT, ...TEMPLATE_EXT]);

// A path is covered when a test mentions it literally, or mentions a prefix of it
// up to a dynamic segment — `/orders/1` covers a template `/orders/:id`.
function covers(testText, endpoint) {
  if (testText.includes(endpoint)) return true;
  const stem = endpoint.replace(/\/:[^/]+/g, "/").replace(/\/+$/, "");
  return stem.length > 1 && testText.includes(stem);
}

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  const endpoints = [];          // {file, path, index}
  let suite = "";
  let sawTest = false;
  for (const file of walk(root, excludes, EXTS, true)) {
    const text = readText(file);
    if (!text) continue;
    if (TEST_RE.test(file)) { sawTest = true; suite += "\n" + text; continue; }
    for (const m of text.matchAll(VERB_ATTR)) {
      endpoints.push({ file, path: m[2], index: m.index, text });
    }
  }
  if (!sawTest) continue;        // no suite in this mount: nothing to measure against
  const seen = new Set();
  for (const e of endpoints) {
    const key = `${e.file}:${e.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (covers(suite, e.path)) continue;
    violations.push({
      rule_id: RULE, file: e.file, ...locate(e.text, e.index),
      evidence: `htmx endpoint "${e.path}" is declared in markup but no test exercises it`,
    });
  }
}
process.stderr.write(`htmx-tester[endpoint-coverage]: ${violations.length} violation(s)\n`);
emit(violations);
