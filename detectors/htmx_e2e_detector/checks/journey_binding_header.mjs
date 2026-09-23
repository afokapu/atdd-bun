#!/usr/bin/env bun
// tester.htmx.journey-binding-header: a journey spec binds to exactly one train or journey by a well-formed header.
import { runCheck, isJourneySpec, TRAIN_ID, JOURNEY_ID, firstLine, lineOf, frontendConfig } from "./_e2e.mjs";
const RULE = "tester.htmx.journey-binding-header";
await runCheck("journey-binding-header", (root, specs, plan, report) => {
  for (const s of specs) {
    if (!isJourneySpec(s)) continue;
    if (!s.binding) { report(RULE, s.file, 1, "journey spec has no `// Train: train:<subject>:<slug>` or `// Journey: journey:<id>` header", firstLine(s.text)); continue; }
    if (s.bindingCount > 1) report(RULE, s.file, s.binding.line, `journey spec declares ${s.bindingCount} \`// Train:\`/\`// Journey:\` headers; bind it to exactly one plan subject`);
    const valid = s.binding.kind === "train" ? TRAIN_ID : JOURNEY_ID;
    if (!valid.test(s.binding.id)) report(RULE, s.file, s.binding.line, `\`${s.binding.id}\` is not a valid ${s.binding.kind} id (${valid.source})`);
  }
});
