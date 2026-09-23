#!/usr/bin/env bun
// coder.bun.responsive-no-fixed-width: no width or min-width wider than the smallest declared viewport.
import { runCheck, declarations, frontendConfig } from "./_responsive.mjs";
const RULE = "coder.bun.responsive-no-fixed-width";
runCheck("responsive-no-fixed-width", (root, files, report) => {
  const limit = frontendConfig(root).viewports[0];
  for (const { file, text } of files) for (const d of declarations(file, text)) {
    if (d.prop !== "width" && d.prop !== "min-width") continue;
    const px = d.numeric ? Number(d.value) : Math.max(0, ...[...d.value.matchAll(/(-?\d*\.?\d+)px\b/g)].map((m) => Number(m[1])));
    if (px > limit) report(RULE, file, text, d.index, `${d.prop}: ${d.numeric ? d.value : `${px}px`} is wider than the smallest viewport (${limit}px); use max-width, a percentage, or a layout that wraps`);
  }
});
