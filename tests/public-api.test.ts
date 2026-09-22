import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { enforce } from "../src/index";

const fixture = (kind: "clean" | "dirty") => resolve(
  import.meta.dir,
  `../detectors/atdd_traceability_closure/fixtures/${kind}`,
);

test("the trace profile is a standalone plan -> test -> source gate", async () => {
  expect(await enforce({ root: fixture("clean"), profiles: ["trace"] })).toEqual([]);
  const ruleIds = new Set((await enforce({ root: fixture("dirty"), profiles: ["trace"] })).map((violation) => violation.rule_id));
  expect(ruleIds).toEqual(new Set([
    "trace.plan.executable-acceptance-has-test",
    "trace.test.binding-resolves",
    "trace.source.tested-by-present",
    "trace.source.tested-by-resolves",
  ]));
});
