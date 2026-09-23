#!/usr/bin/env bun
// tester.htmx.e2e-binds-declared-subject: the train or journey a spec binds to is declared in plan/.
import { runCheck, isJourneySpec, TRAIN_ID, JOURNEY_ID, firstLine, lineOf, frontendConfig } from "./_e2e.mjs";
await runCheck("e2e-binds-declared-subject", (root, specs, plan, report) => {
  if (!plan.hasPlan) return;
  for (const s of specs) {
    if (!isJourneySpec(s) || !s.binding) continue;
    const declared = s.binding.kind === "train" ? plan.trains.has(s.binding.id) : plan.journeyIds.has(s.binding.id);
    if (!declared && (s.binding.kind === "train" ? TRAIN_ID : JOURNEY_ID).test(s.binding.id)) report("tester.htmx.e2e-binds-declared-subject", s.file, s.binding.line, `bound to ${s.binding.id}, which plan/ does not declare; the spec is orphaned from the plan`);
  }
});
