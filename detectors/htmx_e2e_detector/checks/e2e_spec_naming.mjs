#!/usr/bin/env bun
// tester.htmx.e2e-spec-naming: a Playwright spec is named *.e2e.ts, so `bun test` never runs it.
import { runCheck, isJourneySpec, TRAIN_ID, JOURNEY_ID, firstLine, lineOf, frontendConfig } from "./_e2e.mjs";
await runCheck("e2e-spec-naming", (root, specs, plan, report) => {
  for (const s of specs) if (s.playwright && s.declaresTests && !s.e2eNamed) report("tester.htmx.e2e-spec-naming", s.file, 1, "imports @playwright/test but is not named *.e2e.ts; bun test collects *.test.* and *.spec.* files and would run it with the wrong runner", firstLine(s.text));
});
