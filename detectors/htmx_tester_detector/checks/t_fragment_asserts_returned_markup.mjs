#!/usr/bin/env bun
// Member check: tester.htmx.fragment-asserts-returned-markup  (htmx tester family)
//
// THE htmx-SPECIFIC TESTER RULE, and the one with no counterpart in any other
// stack's tester extension.
//
// In a JSON API the response contract is the payload, and asserting on status plus
// a parsed field is a complete test. In htmx the response contract IS THE MARKUP:
// the server returns a fragment and htmx swaps it into the live DOM, so the
// hx-attributes, the element ids the next swap targets, and the structure itself
// are the interface. A test that asserts `expect(res.status).toBe(200)` and stops
// has proven the route exists and NOTHING about what the user will see — including
// whether the fragment still carries the `id` a subsequent out-of-band swap needs.
//
// So: a test case that exercises an HTTP response must assert on the BODY, not only
// on the status line.
import { runCheck, testCases, caseBody } from "../test_header.mjs";

const RULE = "tester.htmx.fragment-asserts-returned-markup";

// The case performs an HTTP round trip.
const DOES_FETCH = /\b(?:fetch|request)\s*\(|\.\s*fetch\s*\(/;
// It asserts on the status line only.
const ASSERTS_STATUS = /expect\s*\(\s*[\w.]*\.\s*(?:status|ok|statusText)\b/;
// It reaches the body in some form: text/json/html, or a markup assertion.
const ASSERTS_BODY = /\.\s*(?:text|json)\s*\(\s*\)|toContain\s*\(|toMatch\s*\(|innerHTML|outerHTML|hx-[a-z]/;

runCheck(RULE, (H, file, text) => {
  const out = [];
  for (const c of testCases(text)) {
    const body = caseBody(text, c.line);
    if (!DOES_FETCH.test(body)) continue;
    if (!ASSERTS_STATUS.test(body)) continue;   // not a status-only test
    if (ASSERTS_BODY.test(body)) continue;      // reaches the markup — fine
    out.push({ line: c.line,
      evidence: "htmx endpoint test asserts only on the status line; the fragment it swaps into the DOM is the contract, so assert on the markup",
      source_line: c.text });
  }
  return out;
});
