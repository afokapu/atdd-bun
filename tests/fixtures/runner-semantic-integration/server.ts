import { JourneyRunner } from "./src/trains/journey";
import { InterlockingRunner } from "./src/trains/interlocking";
import { TrainRunner } from "./src/trains/runner";
export const JOURNEY_MAP = { checkout: { interlockingId: "interlocking:cart", journeyId: "journey:checkout", path: "plan/_journeys/checkout.yaml" } };
export function dispatch(action: string, inputs: Record<string, unknown>) {
  const mapping = JOURNEY_MAP[action as keyof typeof JOURNEY_MAP];
  return new JourneyRunner(mapping.path).execute(action, inputs);
}
