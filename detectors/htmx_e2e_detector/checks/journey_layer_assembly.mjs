#!/usr/bin/env bun
// tester.htmx.journey-layer-assembly: a journey spec declares `// Layer: assembly`.
import { runCheck, isJourneySpec, TRAIN_ID, JOURNEY_ID, firstLine, lineOf, frontendConfig } from "./_e2e.mjs";
const RULE = "tester.htmx.journey-layer-assembly";
await runCheck("journey-layer-assembly", (root, specs, plan, report) => {
  for (const s of specs) {
    if (!isJourneySpec(s)) continue;
    if (!s.layer) report(RULE, s.file, 1, "journey spec has no `// Layer:` header; it MUST be `// Layer: assembly`", firstLine(s.text));
    else if (s.layer.value !== "assembly") report(RULE, s.file, s.layer.line, `\`// Layer: ${s.layer.value}\`: a journey spec exercises the assembled application and MUST declare Layer: assembly`);
  }
});
