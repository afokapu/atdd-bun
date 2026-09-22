// Station Master composition root — CLEAN fixture. Routes both a direct trainId mapping and an
// interlocking route object, references the InterlockingRunner route-control layer, and ultimately
// delegates execution to TrainRunner (core afokapu/atdd#1251).
import { InterlockingRunner } from "./src/trains/interlocking";
import { TrainRunner } from "./src/trains/runner";

export const JOURNEY_MAP: Record<string, string | { interlockingId: string; path: string }> = {
  start_match: "3001-solo-match-complete",
  resolve_match: {
    interlockingId: "interlocking:match-resolution",
    path: "plan/_trains/_interlockings/match-resolution.yaml",
  },
};

export function dispatch(action: string, inputs: Record<string, unknown>, state?: unknown) {
  const mapping = JOURNEY_MAP[action];
  if (typeof mapping === "string") {
    return new TrainRunner(`plan/_trains/${mapping}.yaml`).execute(mapping, inputs);
  }
  const runner = new InterlockingRunner(mapping.path);
  return runner.execute(action, inputs, state);
}
