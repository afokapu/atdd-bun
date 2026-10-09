import { JourneyRunner } from "./src/trains/journey";

export const JOURNEY_MAP = {
  checkout: {
    journeyId: "journey:checkout",
    path: "plan/_journeys/checkout.yaml",
  },
};

export function dispatch(action: string, inputs: Record<string, unknown>, state?: unknown) {
  const mapping = JOURNEY_MAP[action as keyof typeof JOURNEY_MAP];
  return new JourneyRunner(mapping.path).execute(action, inputs, state);
}
