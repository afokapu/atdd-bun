import { JourneyRunner } from "./trains/journey";

const journey = new JourneyRunner("plan/_journeys/match.yaml");
export async function dispatch(_action: string, context: object) {
  await journey.execute("resolve_match", context);
  return { selectedTrainId: "train:journey:nominal" };
}
