#!/usr/bin/env bun
// tester.htmx.journey-urn-format: a journey spec carries test URNs of the canonical grammar, all for its bound subject.
import { runCheck, isJourneySpec, TRAIN_ID, JOURNEY_ID, firstLine, lineOf, frontendConfig } from "./_e2e.mjs";
const RULE = "tester.htmx.journey-urn-format";
await runCheck("journey-urn-format", (root, specs, plan, report) => {
  for (const s of specs) {
    if (!isJourneySpec(s)) continue;
    if (!s.urns.length) { report(RULE, s.file, 1, "journey spec carries no test URN test:{train|journey}:<id>:{E2E|SMOKE|A11Y|VIS|RESP}-NNN-<slug>", firstLine(s.text)); continue; }
    const seen = new Set(), bound = s.binding && (s.binding.kind === "train" ? TRAIN_ID : JOURNEY_ID).test(s.binding.id) ? s.binding.id : null;
    for (const u of s.urns) {
      if (seen.has(u.urn)) continue;
      seen.add(u.urn);
      if (!u.valid) { report(RULE, s.file, lineOf(s.text, u.index), `test URN \`${u.urn}\` is malformed; want test:{train|journey}:<id>:{E2E|SMOKE|A11Y|VIS|RESP}-NNN-<slug>`); continue; }
      const subject = u.urn.slice("test:".length, u.urn.lastIndexOf(":"));
      if (bound && subject !== bound) report(RULE, s.file, lineOf(s.text, u.index), `test URN \`${u.urn}\` names ${subject}, but the spec is bound to ${s.binding.id}`);
    }
  }
});
