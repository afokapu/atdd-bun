// Station Master composition root — routes a direct train and an interlocking route object.
import { InterlockingRunner } from "./src/trains/interlocking";
import { TrainRunner } from "./src/trains/runner";

export const JOURNEY_MAP = {
  start_match: "3001-solo-match-complete",
  resolve_match: {
    interlockingId: "interlocking:match-resolution",
    path: "plan/_trains/_interlockings/match-resolution.yaml",
  },
};

export function dispatch(action: string, inputs: Record<string, unknown>) {
  const mapping = (JOURNEY_MAP as Record<string, unknown>)[action];
  if (typeof mapping === "string") return new TrainRunner(mapping).execute(inputs);
  const { path } = mapping as { interlockingId: string; path: string };
  const res = new InterlockingRunner(path).resolveTrain(action, inputs);
  return new TrainRunner(res.trainId).execute(inputs);
}
