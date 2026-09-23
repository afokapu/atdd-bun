#!/usr/bin/env bun
// tester.htmx.responsive-harness: a RESP spec renders at every declared viewport and asserts no horizontal overflow.
import { maskLiteralsAndComments } from "../../../lib/scan.mjs";
import { runCheck, isJourneySpec, frontendConfig } from "./_e2e.mjs";
await runCheck("responsive-harness", (root, specs, plan, report) => {
  const { viewports } = frontendConfig(root);
  for (const s of specs) {
    if (!isJourneySpec(s) || !s.harnesses.has("RESP")) continue;
    const code = maskLiteralsAndComments(s.text), widths = new Set([...s.text.matchAll(/(?:setViewportSize\s*\(\s*\{|viewport\s*:\s*\{)[^}]*?width\s*:\s*(\d+)/g)].map((m) => Number(m[1])));
    for (const m of s.text.matchAll(/(?:viewports|VIEWPORTS|widths|WIDTHS)\s*=\s*\[([\d\s,]+)\]/g)) for (const n of m[1].split(",")) if (n.trim()) widths.add(Number(n));
    const missing = viewports.filter((w) => !widths.has(w));
    if (missing.length) report("tester.htmx.responsive-harness", s.file, 1, `RESP spec never renders at viewport width(s) ${missing.join(", ")} of the declared ${viewports.join("/")}`);
    if (!/scrollWidth/.test(code) || !/expect\s*\(/.test(code)) report("tester.htmx.responsive-harness", s.file, 1, "RESP spec never asserts on scrollWidth; it must fail when the page overflows the viewport horizontally");
  }
});
