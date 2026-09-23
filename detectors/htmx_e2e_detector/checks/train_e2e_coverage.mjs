#!/usr/bin/env bun
// tester.htmx.train-e2e-coverage: every declared train has at least one browser spec bound to it.
import { runCheck, isJourneySpec, TRAIN_ID, JOURNEY_ID, firstLine, lineOf, frontendConfig } from "./_e2e.mjs";
await runCheck("train-e2e-coverage", (root, specs, plan, report) => {
  const covered = new Set(specs.filter((s) => isJourneySpec(s) && s.binding?.kind === "train").map((s) => s.binding.id));
  for (const train of [...plan.trains].sort()) if (!covered.has(train)) report("tester.htmx.train-e2e-coverage", plan.trainFiles.get(train), 1, `${train} has no browser spec bound by \`// Train: ${train}\`; the journey it declares can regress with nothing turning red`);
});
