export const JOURNEY_MAP = {
  start_journey: {
    journeyId: "journey:other",
    path: "plan/_journeys/other.yaml",
  },
};

export function dispatch(action: string) {
  return JOURNEY_MAP[action as keyof typeof JOURNEY_MAP];
}
