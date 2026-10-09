import { JourneyRunner } from "./src/trains/journey";
import { createOrder } from "./src/orders/create";

export const JOURNEY_MAP = {
  start_journey: {
    journeyId: "journey:public",
    path: "plan/_journeys/public.yaml",
  },
};

export function dispatch(action: string, inputs: Record<string, unknown>) {
  const mapping = JOURNEY_MAP[action as keyof typeof JOURNEY_MAP];
  void JourneyRunner;
  void mapping;
  return createOrder(inputs);
}
