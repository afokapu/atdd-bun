#!/usr/bin/env bun
// tester.htmx.a11y-harness: an A11Y spec runs axe and asserts, in a way that can fail, on its violations.
import { maskLiteralsAndComments } from "../../../lib/scan.mjs";
import { runCheck, isJourneySpec } from "./_e2e.mjs";

// The builder may be imported under any name: `import Axe from ...` or `import { AxeBuilder as Axe } from ...`.
const IMPORT = /import\s+(?:(\w+)|\{\s*AxeBuilder(?:\s+as\s+(\w+))?\s*\})\s+from\s+["']@axe-core\/playwright["']/;
// The assertion must be able to fail: the violations compared with none, or with a bounded count. A tautology
// such as `toBeGreaterThanOrEqual(0)` or `toBeDefined()` asserts nothing about the page.
const ASSERTS = /expect\s*\([^;]*?violations[^;]*?\)\s*\.\s*(toEqual\s*\(\s*\[\s*\]\s*\)|toStrictEqual\s*\(\s*\[\s*\]\s*\)|toHaveLength\s*\(\s*0\s*\)|toBe\s*\(\s*0\s*\)|toBeLessThanOrEqual\s*\(\s*\d+\s*\)|toBeLessThan\s*\(\s*\d+\s*\))/;

await runCheck("a11y-harness", (root, specs, plan, report) => {
  for (const s of specs) {
    if (!isJourneySpec(s) || !s.harnesses.has("A11Y")) continue;
    const code = maskLiteralsAndComments(s.text), imported = s.text.match(IMPORT), builder = imported ? imported[1] ?? imported[2] ?? "AxeBuilder" : null, missing = [];
    if (!builder) missing.push("import AxeBuilder from @axe-core/playwright");
    else if (!new RegExp(`new\\s+${builder}\\s*\\(`).test(code) || !/\.analyze\s*\(/.test(code)) missing.push(`construct ${builder} and call .analyze()`);
    if (!ASSERTS.test(code)) missing.push("assert that the violations are none (toEqual([]), toHaveLength(0)) or bounded (toBeLessThanOrEqual(n))");
    if (missing.length) report("tester.htmx.a11y-harness", s.file, 1, `A11Y spec does not ${missing.join("; ")}; an accessibility check that never runs axe, or cannot fail, passes whatever the page's state`);
  }
});
