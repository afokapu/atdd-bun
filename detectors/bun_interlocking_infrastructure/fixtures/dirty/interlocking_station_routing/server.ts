// DIRTY fixture — coder.bun.station-master-interlocking-routing.
// JOURNEY_MAP declares an interlocking route object but the Station Master never references
// TrainRunner, so the selected train is never delegated for execution.
// Expected: >=1 violation (station-master-no-trainrunner-delegation).
import { InterlockingRunner } from "./src/trains/interlocking";

export const JOURNEY_MAP: Record<string, string | { interlockingId: string; path: string }> = {
  resolve_match: {
    interlockingId: "interlocking:match-resolution",
    path: "plan/_trains/_interlockings/match-resolution.yaml",
  },
};

export function dispatch(action: string, inputs: Record<string, unknown>, state?: unknown) {
  const mapping = JOURNEY_MAP[action] as { interlockingId: string; path: string };
  // BUG: builds the runner but never delegates through TrainRunner.
  const runner = new InterlockingRunner(mapping.path);
  return runner;
}
