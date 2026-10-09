import { expect, test } from "bun:test";
import { join } from "node:path";
import { runImplementation } from "../src/enforce";

const detector = "bun_interlocking_infrastructure";
const fixtures = join(import.meta.dir, "../detectors", detector, "fixtures", "dirty");
const config = { excludes: ["node_modules", ".git", ".atdd"] };

test("JourneyRunner cannot parse a declared continuation then return after its entrypoint", async () => {
  const findings = await runImplementation(detector, {
    ...config,
    scanRoots: [join(fixtures, "journey_continuation_returns_early")],
  });

  expect(findings.map(item => item.evidence)).toContain(
    "journey-runtime-continuation-ignored: JourneyRunner reads a continuation-bearing declaration but returns the entrypoint InterlockingRunner result without consuming continuations and terminals",
  );
});

test("JourneyRunner cannot satisfy continuation enforcement with dead topology reads before an early return", async () => {
  const findings = await runImplementation(detector, {
    ...config,
    scanRoots: [join(fixtures, "journey_continuation_dead_read")],
  });

  expect(findings.map(item => item.evidence)).toContain(
    "journey-runtime-continuation-ignored: JourneyRunner reads a continuation-bearing declaration but returns the entrypoint InterlockingRunner result without consuming continuations and terminals",
  );
});

test("JourneyRunner must advance through the matched continuation and return the matched terminal outcome", async () => {
  const findings = await runImplementation(detector, {
    ...config,
    scanRoots: [join(fixtures, "journey_continuation_self_loop")],
  });

  expect(findings.map(item => item.evidence)).toContain(
    "journey-runtime-continuation-ignored: JourneyRunner reads a continuation-bearing declaration but returns the entrypoint InterlockingRunner result without consuming continuations and terminals",
  );
});

test("Station Master dispatch must invoke its mapped JourneyRunner instead of business logic", async () => {
  const findings = await runImplementation(detector, {
    ...config,
    scanRoots: [join(fixtures, "journey_station_inert_runner")],
  });

  expect(findings.map(item => item.evidence)).toContain(
    "journey-station-dispatch-bypasses-runner: Station Master dispatch must return a JourneyRunner execution for the mapped exposed journey",
  );
});

test("declaration-derived continuation and terminal traversal remains accepted", async () => {
  const findings = await runImplementation(detector, {
    ...config,
    scanRoots: [join(fixtures, "../clean/journey_topology_traversal")],
  });

  expect(findings).toEqual([]);
});
