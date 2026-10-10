import { JourneyRunner } from "./src/trains/journey.test";

export const JOURNEY_MAP = {
  resolve_match: { journeyId: "journey:match", path: "plan/_journeys/match.yaml" },
};

// Identical to the clean dispatch except that JourneyRunner resolves to a test-local module.
export function dispatch(action: keyof typeof JOURNEY_MAP, inputs: object, context: { handlers: object; seed: object }) {
  const mapping = JOURNEY_MAP[action];
  return new JourneyRunner(mapping.path).execute(action, inputs, context);
}
