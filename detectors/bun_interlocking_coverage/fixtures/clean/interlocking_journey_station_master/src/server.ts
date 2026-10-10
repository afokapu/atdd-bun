import { JourneyRunner } from "./trains/journey";

export async function dispatch(action: string, context: object) {
  return await new JourneyRunner("plan/_journeys/match.yaml").execute(action, context);
}
