#!/usr/bin/env bun
// coder.bun.responsive-breakpoints-declared: every @media width is one of the declared breakpoints.
import { runCheck, frontendConfig } from "./_responsive.mjs";
const RULE = "coder.bun.responsive-breakpoints-declared";
runCheck("responsive-breakpoints-declared", (root, files, report) => {
  const { breakpoints } = frontendConfig(root);
  // max-width queries conventionally sit just below a breakpoint (767px, 767.98px); anything within 1px of one is that breakpoint.
  const declared = (px, kind) => breakpoints.some((b) => px === b || (kind === "max" && px < b && b - px <= 1));
  for (const { file, text } of files) for (const media of text.matchAll(/@media[^{]*/gi)) {
    const conditions = [
      ...[...media[0].matchAll(/\b(min|max)-width\s*:\s*(\d*\.?\d+)(px|em|rem)\b/gi)].map((m) => ({ kind: m[1].toLowerCase(), value: m[2], unit: m[3], index: m.index })),
      // Media Queries level 4 range syntax: (width >= 768px), (width < 768px), (768px <= width).
      ...[...media[0].matchAll(/\bwidth\s*(>=|>|<=|<)\s*(\d*\.?\d+)(px|em|rem)\b/gi)].map((m) => ({ kind: m[1].startsWith(">") ? "min" : "max", value: m[2], unit: m[3], index: m.index })),
      ...[...media[0].matchAll(/(\d*\.?\d+)(px|em|rem)\s*(>=|>|<=|<)\s*width\b/gi)].map((m) => ({ kind: m[3].startsWith("<") ? "min" : "max", value: m[1], unit: m[2], index: m.index })),
    ];
    for (const c of conditions) {
      const px = c.unit.toLowerCase() === "px" ? Number(c.value) : Number(c.value) * 16;
      if (!declared(px, c.kind)) report(RULE, file, text, media.index + c.index, `@media ${c.kind === "min" ? "lower" : "upper"} bound ${c.value}${c.unit} is not a declared breakpoint (${breakpoints.join(", ")}); declare it under frontend.breakpoints in atdd-bun.yaml or use one of these`);
    }
  }
});
