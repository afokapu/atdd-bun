// URN: test:toolkit:interlocking-production-proof:E001-UNIT-001-direct-execute
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runImplementation } from "../src/enforce";

const TARGET_RULES = [
  "tester.bun.interlocking-production-runner-used",
  "tester.bun.interlocking-route-coverage",
  "tester.bun.interlocking-trace-binds-declared-route",
  "tester.bun.interlocking-train-sequence-is-exercised",
].sort();

const files: Record<string, string> = {
  "plan/_trains/_interlockings/protocol.yaml": `interlocking_id: interlocking:protocol
entrypoint:
  exposed: false
  actions: [derive_occurrence]
route_resolution:
  strategy: fail_on_multiple_match
routes:
  - route_id: interpret-choice
    train_id: train:protocol:interpret-choice
    train_path: plan/_trains/train:protocol:interpret-choice.yaml
    category: nominal
    guard_ref: guard:interpret-choice
`,
  "plan/_trains/train:protocol:interpret-choice.yaml": `train_id: train:protocol:interpret-choice
sequence:
  - step: 1
    from: system:resolver
    to: wagon:choice
    artifact: authority:choice.recorded
`,
  "src/trains/runner.ts": `export type Resolution = Readonly<{
  interlockingId: string; routeId: string; trainId: string; trainPath: string;
  category: string; guardId: string; resolutionStrategy: string; reason: string;
}>;
export type Handler = (inputs: Record<string, unknown>) => unknown;
export class TrainRunner {
  constructor(private readonly handlers: Readonly<Record<string, Handler>>) {}
  async execute(resolution: Resolution, inputs: Record<string, unknown>) {
    const step = { step: 1, from: "system:resolver", to: "wagon:choice", artifact: "authority:choice.recorded" };
    return {
      status: "completed" as const,
      steps: [step],
      cargo: { [step.artifact]: this.handlers[step.artifact]?.(inputs) },
      trace: {
        interlockingId: resolution.interlockingId,
        routeId: resolution.routeId,
        selectedTrainId: resolution.trainId,
        routeCategory: resolution.category,
        guardId: resolution.guardId,
        resolutionStrategy: resolution.resolutionStrategy,
        resolutionReason: resolution.reason,
      },
    };
  }
}
`,
  "src/trains/interlocking.ts": `import { TrainRunner, type Resolution } from "./runner";
export class InterlockingRunner {
  private readonly trainRunner: TrainRunner;
  constructor({ trainRunner }: { trainRunner: TrainRunner }) { this.trainRunner = trainRunner; }
  async resolveTrain(_action: string, _inputs: Record<string, unknown>): Promise<Resolution> {
    return {
      interlockingId: "interlocking:protocol", routeId: "interpret-choice",
      trainId: "train:protocol:interpret-choice", trainPath: "plan/_trains/train:protocol:interpret-choice.yaml",
      category: "nominal", guardId: "guard:interpret-choice",
      resolutionStrategy: "fail_on_multiple_match", reason: "guard guard:interpret-choice held",
    };
  }
  async execute(action: string, inputs: Record<string, unknown>) {
    const resolution = await this.resolveTrain(action, inputs);
    return { resolution, trainResult: await this.trainRunner.execute(resolution, inputs) };
  }
}
`,
  "src/server.ts": `import { InterlockingRunner } from "./trains/interlocking";
import { TrainRunner } from "./trains/runner";
const handlers = { "authority:choice.recorded": () => ({ outcome: "refused" }) };
export const trainRunner = new TrainRunner(handlers);
export const interlockingRunner = new InterlockingRunner({ trainRunner });
`,
  "e2e/interlockings/protocol/interpret-choice.routes.test.ts": `// Phase: E2E
import { expect, test } from "bun:test";
import { interlockingRunner, trainRunner } from "../../../src/server";
import { InterlockingRunner } from "../../../src/trains/interlocking";
import { TrainRunner } from "../../../src/trains/runner";
test("production InterlockingRunner.execute proves the selected route and train", async () => {
  expect(interlockingRunner).toBeInstanceOf(InterlockingRunner);
  expect(trainRunner).toBeInstanceOf(TrainRunner);
  const { resolution, trainResult } = await interlockingRunner.execute("derive_occurrence", {});
  expect(resolution.routeId).toBe("interpret-choice");
  expect(resolution.trainId).toBe("train:protocol:interpret-choice");
  expect(trainResult.steps).toEqual([
    { step: 1, from: "system:resolver", to: "wagon:choice", artifact: "authority:choice.recorded" },
  ]);
  expect(trainResult.steps).toContainEqual(expect.objectContaining({ from: "system:resolver", to: "wagon:choice" }));
  expect(trainResult.steps.at(-1)).toEqual(expect.objectContaining({ artifact: "authority:choice.recorded" }));
  const trace = trainResult.trace;
  expect(trace.interlockingId).toBe("interlocking:protocol");
  expect(trace.routeId).toBe("interpret-choice");
  expect(trace.selectedTrainId).toBe("train:protocol:interpret-choice");
  expect(trace.routeCategory).toBe("nominal");
  expect(trace.guardId).toBe("guard:interpret-choice");
  expect(trace.resolutionStrategy).toBe("fail_on_multiple_match");
  expect(trace.resolutionReason).toBe("guard guard:interpret-choice held");
  expect(trainResult.cargo["authority:choice.recorded"]).toEqual({ outcome: "refused" });
});
`,
};

type Mutation = { file: string; from: string; to: string; all?: boolean; extra?: Record<string, string> };

async function findings(mutation?: Mutation) {
  const root = await mkdtemp(join(tmpdir(), "atdd-interlocking-execute-"));
  try {
    const written = { ...files };
    if (mutation) {
      const before = written[mutation.file]!;
      written[mutation.file] = mutation.all
        ? before.replaceAll(mutation.from, mutation.to)
        : before.replace(mutation.from, mutation.to);
      expect(written[mutation.file], `${mutation.file}: ${mutation.from}`).not.toBe(before);
      Object.assign(written, mutation.extra);
    }
    for (const [relative, text] of Object.entries(written)) {
      const path = join(root, relative);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
    }
    const found = await runImplementation("bun_interlocking_coverage", {
      scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"],
    });
    return [...new Set(found.map(({ rule_id }) => rule_id).filter((id) => TARGET_RULES.includes(id)))].sort();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("asserted production InterlockingRunner.execute clears all four shared proof findings", async () => {
  expect(await findings()).toEqual([]);
});

const detached = `  const resolution = { routeId: "interpret-choice", trainId: "train:protocol:interpret-choice" };
  const trainResult = { steps: [{ step: 1, from: "system:resolver", to: "wagon:choice", artifact: "authority:choice.recorded" }], trace: { interlockingId: "interlocking:protocol", routeId: "interpret-choice", selectedTrainId: "train:protocol:interpret-choice", routeCategory: "nominal", guardId: "guard:interpret-choice", resolutionStrategy: "fail_on_multiple_match", resolutionReason: "guard guard:interpret-choice held" }, cargo: {} };`;

const negatives: Record<string, Mutation> = {
  "unasserted execution": {
    file: "e2e/interlockings/protocol/interpret-choice.routes.test.ts",
    from: "expect(",
    to: "void (",
    all: true,
  },
  "detached business literals": {
    file: "e2e/interlockings/protocol/interpret-choice.routes.test.ts",
    from: `  const { resolution, trainResult } = await interlockingRunner.execute("derive_occurrence", {});`,
    to: `  await interlockingRunner.execute("derive_occurrence", {});\n${detached}`,
  },
  "test-module fake InterlockingRunner": {
    file: "src/server.ts",
    from: `import { InterlockingRunner } from "./trains/interlocking";`,
    to: `import { InterlockingRunner } from "./trains/interlocking.test";`,
    extra: { "src/trains/interlocking.test.ts": `export class InterlockingRunner { constructor(_value: unknown) {} async execute() { return {}; } }\n` },
  },
  "server composition without production TrainRunner": {
    file: "src/server.ts",
    from: `export const trainRunner = new TrainRunner(handlers);`,
    to: `export const trainRunner = { execute: async () => ({ steps: [], trace: {}, cargo: {} }) };`,
  },
  "prototype override": {
    file: "e2e/interlockings/protocol/interpret-choice.routes.test.ts",
    from: `import { TrainRunner } from "../../../src/trains/runner";`,
    to: `import { TrainRunner } from "../../../src/trains/runner";\nInterlockingRunner.prototype.execute = async () => ({}) as never;`,
  },
  "class-field execute override": {
    file: "src/trains/interlocking.ts",
    from: `  async execute(action: string, inputs: Record<string, unknown>) {`,
    to: `  execute = async (action: string, inputs: Record<string, unknown>) => {`,
  },
  "exported receiver override": {
    file: "src/server.ts",
    from: `export const interlockingRunner = new InterlockingRunner({ trainRunner });`,
    to: `export const interlockingRunner = new InterlockingRunner({ trainRunner });\n(interlockingRunner as any).execute = async () => ({});`,
  },
};

for (const [name, mutation] of Object.entries(negatives)) {
  test(`strict production proof rejects ${name}`, async () => {
    expect(await findings(mutation)).toEqual(TARGET_RULES);
  });
}
