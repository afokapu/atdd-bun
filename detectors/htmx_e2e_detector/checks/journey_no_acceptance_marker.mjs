#!/usr/bin/env bun
// tester.htmx.journey-no-acceptance-marker: journey and acceptance identities are exclusive.
import { runCheck, isJourneySpec, TRAIN_ID, JOURNEY_ID, firstLine, lineOf, frontendConfig } from "./_e2e.mjs";
await runCheck("journey-no-acceptance-marker", (root, specs, plan, report) => {
  for (const s of specs) if (isJourneySpec(s) && s.acceptance) report("tester.htmx.journey-no-acceptance-marker", s.file, lineOf(s.text, s.acceptance.index + s.acceptance[0].search(/\S/)), `journey spec carries \`// ${s.acceptance[1]}:\`; a journey test binds to a train or journey, an acceptance test to an Acceptance/WMBT pair, never both`);
});
