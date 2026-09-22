#!/usr/bin/env bun
// Member check: tester.htmx.swap-oob-asserts-destination-id  (htmx tester family)
//
// The tester half of `coder.htmx.swap-oob-carries-id`. That rule makes the SERVER
// emit an id on an out-of-band element; this one makes the TEST prove the id is the
// one the page will actually match.
//
// The pair matters because the failure is silent from both sides: htmx drops an oob
// element whose id matches nothing in the document, with no error and no swap. A
// test that asserts the response merely CONTAINS `hx-swap-oob` has confirmed the
// server's half and nothing about the destination — which is the half that breaks
// when a template is refactored.
//
// Mirrors tester.convex.interlocking-trace-binds-declared-route in shape: an
// assertion on a runtime artefact must bind back to the declaration it came from.
import { runCheck, testCases, caseBody } from "../test_header.mjs";

const RULE = "tester.htmx.swap-oob-asserts-destination-id";
const MENTIONS_OOB = /hx-swap-oob/;
// An assertion that reaches the destination id: an `id=` in an expected string, or
// a DOM lookup by id.
const ASSERTS_ID = /id\s*=\s*["'\\]|getElementById|querySelector\s*\(\s*['"`]#|toHaveAttribute\s*\(\s*['"`]id/;

runCheck(RULE, (H, file, text) => {
  const out = [];
  for (const c of testCases(text)) {
    const body = caseBody(text, c.line);
    if (!MENTIONS_OOB.test(body)) continue;
    if (ASSERTS_ID.test(body)) continue;
    // Name the case: the finding is per `it()`, and a report of three identical
    // sentences makes the reader diff line numbers to tell them apart.
    const title = (c.text.match(/["'`]([^"'`]+)["'`]/) || [])[1] || "this case";
    out.push({ line: c.line,
      evidence: `test case "${title}" asserts an hx-swap-oob element is present but never asserts the destination id; htmx drops an oob element that matches nothing, silently`,
      source_line: c.text });
  }
  return out;
});
