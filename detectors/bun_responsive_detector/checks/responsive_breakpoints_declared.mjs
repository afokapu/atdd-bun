#!/usr/bin/env bun
// coder.bun.responsive-breakpoints-declared: every @media width is one of the declared breakpoints.
import { runCheck, frontendConfig } from "./_responsive.mjs";
const RULE = "coder.bun.responsive-breakpoints-declared";
runCheck("responsive-breakpoints-declared", (root, files, report) => {
  const { breakpoints } = frontendConfig(root);
  // max-width queries conventionally sit just below a breakpoint (767px, 767.98px); anything within 1px of one is that breakpoint.
  const declared = (px, kind) => breakpoints.some((b) => px === b || (kind === "max" && px < b && b - px <= 1));
  for (const { file, text } of files) for (const media of text.matchAll(/@media[^{]*/gi)) {
    for (const m of media[0].matchAll(/\b(min|max)-width\s*:\s*(\d*\.?\d+)(px|em|rem)\b/gi)) {
      const px = m[3].toLowerCase() === "px" ? Number(m[2]) : Number(m[2]) * 16;
      if (!declared(px, m[1].toLowerCase())) report(RULE, file, text, media.index + m.index, `@media ${m[1]}-width: ${m[2]}${m[3]} is not a declared breakpoint (${breakpoints.join(", ")}); declare it under frontend.breakpoints in atdd-bun.yaml or use one of these`);
    }
  }
});
