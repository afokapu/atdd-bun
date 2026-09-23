#!/usr/bin/env bun
// tester.htmx.exposed-journey-e2e-coverage: every exposed journey has an E2E or SMOKE browser spec bound to it.
import { runCheck, isJourneySpec, TRAIN_ID, JOURNEY_ID, firstLine, lineOf, frontendConfig } from "./_e2e.mjs";
await runCheck("exposed-journey-e2e-coverage", (root, specs, plan, report) => {
  const covered = new Set(specs.filter((s) => isJourneySpec(s) && s.binding?.kind === "journey" && (s.harnesses.has("E2E") || s.harnesses.has("SMOKE"))).map((s) => s.binding.id));
  for (const j of plan.journeys) if (j.exposed && !covered.has(j.id)) report("tester.htmx.exposed-journey-e2e-coverage", j.path, 1, `exposed journey ${j.id} has no E2E or SMOKE browser spec bound by \`// Journey: ${j.id}\``);
});
