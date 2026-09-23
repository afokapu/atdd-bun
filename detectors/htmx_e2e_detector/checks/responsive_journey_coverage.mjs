#!/usr/bin/env bun
// tester.htmx.responsive-journey-coverage: every exposed journey has a RESP browser spec bound to it.
import { runCheck, isJourneySpec, TRAIN_ID, JOURNEY_ID, firstLine, lineOf, frontendConfig } from "./_e2e.mjs";
await runCheck("responsive-journey-coverage", (root, specs, plan, report) => {
  const covered = new Set(specs.filter((s) => isJourneySpec(s) && s.binding?.kind === "journey" && s.harnesses.has("RESP")).map((s) => s.binding.id));
  for (const j of plan.journeys) if (j.exposed && !covered.has(j.id)) report("tester.htmx.responsive-journey-coverage", j.path, 1, `exposed journey ${j.id} has no RESP browser spec bound by \`// Journey: ${j.id}\`; nothing proves its screens work from mobile to desktop`);
});
