import { JourneyRunner } from "./src/trains/journey";

export const JOURNEY_MAP = {
  start_journey: {
    journeyId: "journey:public",
    path: "plan/_journeys/public.yaml",
  },
};

export function dispatch(action: string, inputs: Record<string, unknown>, state?: unknown) {
  const mapping = JOURNEY_MAP[action as keyof typeof JOURNEY_MAP];
  return new JourneyRunner(mapping.path).execute(action, inputs, state);
}
