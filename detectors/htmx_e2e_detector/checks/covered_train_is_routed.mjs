#!/usr/bin/env bun
// tester.htmx.covered-train-is-routed: a train a spec covers is selected by some interlocking route.
import { runCheck, isJourneySpec, TRAIN_ID, JOURNEY_ID, firstLine, lineOf, frontendConfig } from "./_e2e.mjs";
await runCheck("covered-train-is-routed", (root, specs, plan, report) => {
  for (const s of specs) if (isJourneySpec(s) && s.binding?.kind === "train" && plan.trains.has(s.binding.id) && !plan.routed.has(s.binding.id)) report("tester.htmx.covered-train-is-routed", s.file, s.binding.line, `${s.binding.id} is declared but no interlocking route selects it, so nothing in the application can reach what this spec exercises`);
});
