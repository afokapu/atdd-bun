#!/usr/bin/env bun
// tester.htmx.a11y-harness: an A11Y spec runs axe and asserts on its violations.
import { maskLiteralsAndComments } from "../../../lib/scan.mjs";
import { runCheck, isJourneySpec } from "./_e2e.mjs";
await runCheck("a11y-harness", (root, specs, plan, report) => {
  for (const s of specs) {
    if (!isJourneySpec(s) || !s.harnesses.has("A11Y")) continue;
    const code = maskLiteralsAndComments(s.text), missing = [];
    if (!/import\s+(?:\{\s*)?AxeBuilder(?:\s*\})?\s+from\s+["']@axe-core\/playwright["']/.test(s.text)) missing.push("import AxeBuilder from @axe-core/playwright");
    if (!/new\s+AxeBuilder\s*\(/.test(code) || !/\.analyze\s*\(/.test(code)) missing.push("construct AxeBuilder and call .analyze()");
    if (!/expect\s*\([^;]*violations/.test(code)) missing.push("assert on the returned violations");
    if (missing.length) report("tester.htmx.a11y-harness", s.file, 1, `A11Y spec does not ${missing.join(", ")}; an accessibility check that never runs axe, or never asserts, passes whatever the page's state`);
  }
});
