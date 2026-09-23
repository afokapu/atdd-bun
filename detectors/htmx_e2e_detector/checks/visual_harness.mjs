#!/usr/bin/env bun
// tester.htmx.visual-harness: a VIS spec compares a screenshot.
import { maskLiteralsAndComments } from "../../../lib/scan.mjs";
import { runCheck, isJourneySpec } from "./_e2e.mjs";
await runCheck("visual-harness", (root, specs, plan, report) => {
  for (const s of specs) if (isJourneySpec(s) && s.harnesses.has("VIS") && !/\.(toHaveScreenshot|toMatchSnapshot)\s*\(/.test(maskLiteralsAndComments(s.text))) report("tester.htmx.visual-harness", s.file, 1, "VIS spec never calls toHaveScreenshot() or toMatchSnapshot(); a visual spec that compares no screenshot performs no visual regression");
});
