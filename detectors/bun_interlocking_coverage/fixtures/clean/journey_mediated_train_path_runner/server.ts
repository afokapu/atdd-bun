import { JourneyRunner } from "./src/trains/journey";

export const JOURNEY_MAP = {
  resolve_match: { journeyId: "journey:match", path: "plan/_journeys/match.yaml" },
};

export function dispatch(action: keyof typeof JOURNEY_MAP, inputs: object, context: { handlers: object; seed: object }) {
  const mapping = JOURNEY_MAP[action];
  return new JourneyRunner(mapping.path).execute(action, inputs, context);
}
