#!/usr/bin/env bun
// tester.htmx.responsive-harness: a RESP spec renders at every declared viewport and asserts no horizontal overflow.
import { maskLiteralsAndComments } from "../../../lib/scan.mjs";
import { runCheck, isJourneySpec, frontendConfig } from "./_e2e.mjs";

/** The widths a spec actually renders at: literal viewport widths, or a list of widths it iterates. */
function renderedWidths(code) {
  const widths = new Set([...code.matchAll(/(?:setViewportSize\s*\(\s*\{|viewport\s*:\s*\{)[^}]*?width\s*:\s*(\d+)/g)].map((m) => Number(m[1])));
  const add = (list) => { for (const n of list.split(",")) if (n.trim()) widths.add(Number(n)); };
  for (const m of code.matchAll(/for\s*\(\s*(?:const|let|var)\s+\w+\s+of\s+\[([\d\s,]+)\]/g)) add(m[1]);
  // A named list counts only when it is iterated; picking `VIEWPORTS[0]` renders one width, not all of them.
  for (const m of code.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*\[([\d\s,]+)\]/g)) if (new RegExp(`(of\\s+${m[1]}\\b|\\b${m[1]}\\s*\\.\\s*(forEach|map)\\s*\\()`).test(code)) add(m[2]);
  return widths;
}

/** Whether some expect() takes scrollWidth, directly or through a variable measured from it. */
function assertsOverflow(code) {
  const measured = [...code.matchAll(/(?:const|let|var)\s+(\w+)\s*=[^;]*scrollWidth/g)].map((m) => m[1]);
  return [...code.matchAll(/expect\s*\(([^;]*?)\)\s*\./g)].some((m) => /scrollWidth/.test(m[1]) || measured.some((name) => new RegExp(`\\b${name}\\b`).test(m[1])));
}

await runCheck("responsive-harness", (root, specs, plan, report) => {
  const { viewports } = frontendConfig(root);
  for (const s of specs) {
    if (!isJourneySpec(s) || !s.harnesses.has("RESP")) continue;
    const code = maskLiteralsAndComments(s.text), widths = renderedWidths(code), missing = viewports.filter((w) => !widths.has(w));
    if (missing.length) report("tester.htmx.responsive-harness", s.file, 1, `RESP spec never renders at viewport width(s) ${missing.join(", ")} of the declared ${viewports.join("/")}`);
    if (!assertsOverflow(code)) report("tester.htmx.responsive-harness", s.file, 1, "RESP spec never asserts on scrollWidth; it must fail when the page overflows the viewport horizontally");
  }
});
