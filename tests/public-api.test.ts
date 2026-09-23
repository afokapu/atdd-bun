import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { enforce } from "../src/index";

const fixture = (kind: "clean" | "dirty") => resolve(
  import.meta.dir,
  `../detectors/atdd_traceability_closure/fixtures/${kind}`,
);

test("the traceability profile is a standalone plan -> test -> source gate", async () => {
  expect(await enforce({ root: fixture("clean"), profiles: ["traceability"] })).toEqual([]);
  const ruleIds = new Set((await enforce({ root: fixture("dirty"), profiles: ["traceability"] })).map((violation) => violation.rule_id));
  expect(ruleIds).toEqual(new Set([
    "traceability.plan.executable-acceptance-has-test",
    "traceability.test.binding-resolves",
    "traceability.source.tested-by-present",
    "traceability.source.tested-by-resolves",
    "traceability.lifecycle.status-valid",
    "traceability.lifecycle.acceptance-single-owner",
    "traceability.lifecycle.implemented-feature-has-source",
    "traceability.train.executable-train-has-test",
  ]));
});
