// Supplies test-only wagon handlers for production runner topology proofs.
import type { WagonHandlerRegistry } from "../../src/trains/runner.ts";

/** Builds an inert test handler for the declared train without composing domain services. */
export async function testTrainContext(trainPath: string): Promise<Readonly<{ seed: Record<string, unknown>; handlers: WagonHandlerRegistry }>> {
  const wagon = trainPath.replace(/^plan\/_trains\/|\.yaml$/g, "");
  return { seed: {}, handlers: { [wagon]: () => ({ inert: true }) } };
}
