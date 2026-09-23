#!/usr/bin/env bun
// tester.htmx.presentation-smoke-coverage: every presentation component is covered by a SMOKE browser spec naming its wagon.
import { relative, sep } from "node:path";
import { walk } from "../../../lib/scan.mjs";
import { runCheck, isJourneySpec } from "./_e2e.mjs";
await runCheck("presentation-smoke-coverage", async (root, specs, plan, report) => {
  const { readExcludes } = await import("../../../lib/scan.mjs");
  const smoke = specs.filter((s) => isJourneySpec(s) && s.harnesses.has("SMOKE")).map((s) => relative(root, s.file));
  for (const file of walk(root, readExcludes(), new Set([".tsx", ".jsx"]))) {
    const parts = relative(root, file).split(sep), at = parts.lastIndexOf("presentation");
    if (at < 1 || at === parts.length - 1) continue;
    const wagon = parts[at - 1], token = new RegExp(`(^|[^a-z0-9])${wagon.replace(/[^a-z0-9-]/gi, "")}([^a-z0-9]|$)`, "i");
    if (!smoke.some((path) => token.test(path))) report("tester.htmx.presentation-smoke-coverage", file, 1, `presentation component of wagon "${wagon}" has no SMOKE browser spec whose path names the wagon`);
  }
});
