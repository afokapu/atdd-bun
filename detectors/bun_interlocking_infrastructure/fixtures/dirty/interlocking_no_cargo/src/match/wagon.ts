// DIRTY fixture — coder.bun.interlocking-does-not-carry-cargo (wagon side).
// A wagon MUST NOT import interlocking code — that couples the artifact plane to route control.
// Expected: >=1 violation (wagon-imports-interlocking).
import { InterlockingRunner } from "../src/trains/interlocking";

export function runMatch(cargo: Map<string, unknown>): Map<string, unknown> {
  // BUG: wagon reaches into the route-control layer.
  const _runner = InterlockingRunner;
  cargo.set("match", { result: { validForRanked: true } });
  return cargo;
}
