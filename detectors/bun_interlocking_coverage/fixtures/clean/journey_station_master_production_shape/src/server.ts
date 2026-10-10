import { JourneyRunner } from "./trains/journey.ts";
import { UnavailableWagonError, type WagonHandlerRegistry } from "./trains/runner.ts";

type StationRoute = Readonly<{ journeyId: string; path: string; interlockingId: string }>;

export const JOURNEY_MAP: Readonly<Record<string, StationRoute>> = {
  create_world: {
    journeyId: "journey:create-world-pack",
    path: "plan/_journeys/create-world-pack.yaml",
    interlockingId: "interlocking:source-corpus-admission",
  },
  create_scenario: {
    journeyId: "journey:play-world-scenario",
    path: "plan/_journeys/play-world-scenario.yaml",
    interlockingId: "interlocking:scenario-compilation",
  },
  replay_session: {
    journeyId: "journey:replay-world-session",
    path: "plan/_journeys/replay-world-session.yaml",
    interlockingId: "interlocking:session-replay",
  },
};

const unavailableWagonHandlers: WagonHandlerRegistry = {};

// Source admission is the one composition with production handlers; it reports what it refused.
function sourceWagonHandlers(supported: boolean) {
  let refusal: string | undefined;
  return {
    handlers: {
      "train:source:refuse": () => {
        if (!supported) refusal = "UNSUPPORTED_SOURCE_FORMAT";
        return { refused: !supported };
      },
    } as WagonHandlerRegistry,
    result: () => (refusal ? { refusal } : { admitted: true }),
  };
}

/** Production Station Master entrypoint for declared runtime journey actions. */
export async function executeAction(action: keyof typeof JOURNEY_MAP, inputs: Record<string, unknown>) {
  const mapping = JOURNEY_MAP[action];
  if (!mapping) throw new Error(`Station Master action is not declared: ${action}`);
  const sourceRun = action === "create_world"
    ? sourceWagonHandlers(Boolean((inputs.source as { required_supported?: boolean } | undefined)?.required_supported))
    : undefined;
  try {
    const execution = await new JourneyRunner(mapping.path).execute(action, inputs, {
      initialArtifacts: action === "create_world" ? { "world:source:submission": inputs.source_submission } : {},
      handlers: sourceRun?.handlers ?? unavailableWagonHandlers,
      // Semantic continuations stay explicit deployment work; source remains bounded.
      continueOnContinuation: false,
    });
    return sourceRun ? { ...execution, source: sourceRun.result() } : execution;
  } catch (error) {
    if (error instanceof UnavailableWagonError)
      return Object.freeze({
        disposition: "INCOMPLETE_CONTINUATION" as const,
        status: error.status,
        trainId: error.trainId,
        wagon: error.wagon,
      });
    throw error;
  }
}

/** HTTP-shaped Station Master for source admission. */
export async function stationMaster(command: { submission: { id: string }; supported: boolean }): Promise<Response> {
  const execution = await executeAction("create_world", {
    source: { required_supported: command.supported },
    source_submission: command.submission,
  });
  if ("disposition" in execution)
    return Response.json(execution, { status: execution.status });
  const sourceResult = "source" in execution ? execution.source : undefined;
  const refused = Boolean(sourceResult && typeof sourceResult === "object" && "refusal" in sourceResult);
  return Response.json(sourceResult, {
    status: refused ? 422 : 201,
    headers: {
      "x-journey-disposition": "TERMINAL",
      "x-train-output-artifact": execution.terminal.artifact,
      "x-train-wagons": execution.wagons.join(","),
    },
  });
}
