import { expect, test } from "bun:test";
import { join } from "node:path";
import { runImplementation } from "../src/enforce";

const fixture = join(import.meta.dir, "fixtures/journey-runaway");
const config = { scanRoots: [fixture], excludes: ["node_modules", ".git", ".atdd"] };

test("runaway consumer proves valid planner topology cannot hide a transcribed runtime", async () => {
  const [integrity, schemas, planner, runtime] = await Promise.all([
    runImplementation("planner_plan_integrity", config),
    runImplementation("planner_schema_validation", config),
    runImplementation("planner_static_validators", config),
    runImplementation("bun_interlocking_infrastructure", config),
  ]);

  // The declared model is intentionally sound. If these fail, the experiment is not isolating
  // runtime transcription; it is merely feeding a broken plan to the system.
  expect(integrity).toEqual([]);
  expect(schemas).toEqual([]);
  expect(planner.filter(item => item.rule_id === "planner.journey.continuation-closure")).toEqual([]);

  // The runtime looks layered (JourneyRunner -> InterlockingRunner) but ignores the declaration.
  // Both independent symptoms must break proof: no declaration read, and a literal hidden topology edge.
  const journey = runtime.filter(item => item.rule_id === "coder.bun.journey-runner-boundary");
  expect(journey.map(item => item.evidence)).toContain(
    "journey-runtime-transcription: JourneyRunner does not read and parse a journey declaration; topology may be hardcoded",
  );
  expect(journey.some(item => item.evidence.includes("journey-runtime-hidden-topology") && item.evidence.includes("rogue.yaml"))).toBe(true);
});
