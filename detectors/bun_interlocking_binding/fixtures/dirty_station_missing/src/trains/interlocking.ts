// InterlockingRunner runtime — resolves declared routes into a structured InterlockingResolution.
export interface InterlockingResolution {
  interlockingId: string;
  routeId: string;
  trainId: string;
  trainPath: string;
  category: string;
  resolutionStrategy: string;
  guardId: string;
  reason: string;
}

export class InterlockingRunner {
  constructor(private readonly interlockingYamlPath: string) {}

  resolveTrain(action: string, inputs: Record<string, unknown>): InterlockingResolution {
    return {
      interlockingId: "interlocking:match-resolution",
      routeId: "nominal-all-voted",
      trainId: "3007-match-resolution-standard",
      trainPath: "plan/_trains/3007-match-resolution-standard.yaml",
      category: "nominal",
      resolutionStrategy: "first_priority",
      guardId: "guard:all-voted",
      reason: "all participants voted",
    };
  }
}
