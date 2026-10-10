import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";

const fixtures = resolve(import.meta.dir, "../detectors/bun_interlocking_coverage/fixtures");
const positive = join(fixtures, "clean", "journey_mediated_train_path_runner");
const SMOKE = "tester.bun.interlocking-smoke-coverage-for-station-master";
const run = (root: string) => runImplementation("bun_interlocking_coverage", {
  scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"],
});
const smoke = (findings: Awaited<ReturnType<typeof run>>) => findings.filter(finding => finding.rule_id === SMOKE);

// Each mutant is the persisted positive fixture with exactly one file replaced, so a smoke finding can
// only come from that file's defect, never from an unrelated gap elsewhere in the corpus.
async function mutant(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "atdd-journey-runner-mutant-"));
  await cp(positive, root, { recursive: true });
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content);
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const interlocking = (body: string, extra = "") => `import { TrainRunner } from "./runner";

export class InterlockingRunner {
  constructor(private readonly interlockingPath: string) {}
  resolveTrain(_action: string, _inputs: object) {
    return { routeId: "nominal", trainId: "train:match:nominal", trainPath: "plan/_trains/train:match:nominal.yaml" };
  }
  execute(action: string, inputs: object, context: { handlers: object; seed: object }) {
${body}
  }${extra}
}
`;

const server = (imports: string, body: string) => `${imports}

export const JOURNEY_MAP = {
  resolve_match: { journeyId: "journey:match", path: "plan/_journeys/match.yaml" },
};

export function dispatch(action: keyof typeof JOURNEY_MAP, inputs: object, context: { handlers: object; seed: object }) {
  const mapping = JOURNEY_MAP[action];
${body}
}
`;
const journeyReturn = "  return new JourneyRunner(mapping.path).execute(action, inputs, context);";
const journeySource = `import { InterlockingRunner } from "./interlocking";

export class JourneyRunner {
  constructor(private readonly journeyPath: string) {}
  execute(action: string, inputs: object, context: { handlers: object; seed: object }) {
    return new InterlockingRunner(this.journeyPath).execute(action, inputs, context);
  }
}
`;

test("exported dispatch -> JourneyRunner -> InterlockingRunner -> TrainRunner(resolution.trainPath, handlers).execute(resolution, seed) is accepted", async () => {
  expect(await run(positive)).toEqual([]);
});

test("the persisted positive also clears when execute arguments span lines and are awaited", async () => {
  expect(await mutant({
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    return await new TrainRunner(resolution.trainPath, context.handlers).execute(
      resolution,
      context.seed,
    );`).replace("  execute(action", "  async execute(action"),
  })).toEqual([]);
});

const trainPathMutants: Record<string, string> = {
  "fabricated path object": `    const resolution = this.resolveTrain(action, inputs);
    const fabricated = { trainPath: "plan/_trains/train:match:nominal.yaml" };
    return new TrainRunner(fabricated.trainPath, context.handlers).execute(resolution, context.seed);`,
  "literal path": `    const resolution = this.resolveTrain(action, inputs);
    return new TrainRunner("plan/_trains/train:match:nominal.yaml", context.handlers).execute(resolution, context.seed);`,
  "execute receives resolution.trainId": `    const resolution = this.resolveTrain(action, inputs);
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution.trainId, context.seed);`,
  "execute receives resolution.selectedTrainId": `    const resolution = this.resolveTrain(action, inputs);
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution.selectedTrainId, context.seed);`,
  "execute receives a fabricated object": `    const resolution = this.resolveTrain(action, inputs);
    return new TrainRunner(resolution.trainPath, context.handlers).execute({ trainId: "train:match:nominal" }, context.seed);`,
  "execute receives an unrelated resolution": `    const resolution = this.resolveTrain(action, inputs);
    const other = { trainId: "train:match:nominal", trainPath: resolution.trainPath };
    return new TrainRunner(resolution.trainPath, context.handlers).execute(other, context.seed);`,
  "path property reassigned before construction": `    const resolution = this.resolveTrain(action, inputs);
    resolution.trainPath = "plan/_trains/train:unrelated.yaml";
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`,
  "resolution variable reassigned before construction": `    let resolution = this.resolveTrain(action, inputs);
    resolution = { ...resolution, trainPath: "plan/_trains/train:unrelated.yaml" };
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`,
  "resolveTrain on an unrecognized receiver": `    const fake = { resolveTrain: (_a: string, _i: object) => ({ trainId: "train:match:nominal", trainPath: "plan/_trains/train:match:nominal.yaml" }) };
    const resolution = fake.resolveTrain(action, inputs);
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`,
};

for (const [name, body] of Object.entries(trainPathMutants)) {
  test(`declaration-path proof rejects ${name}`, async () => {
    expect(smoke(await mutant({ "src/trains/interlocking.ts": interlocking(body) }))).not.toEqual([]);
  });
}

test("declaration-path proof rejects a same-name resolution fabricated in a different scope", async () => {
  expect(smoke(await mutant({
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    void resolution;
    return this.fabricated(context);`, `
  fabricated(context: { handlers: object; seed: object }) {
    const resolution = { trainId: "train:match:nominal", trainPath: "plan/_trains/train:match:nominal.yaml" };
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
  }`),
  }))).not.toEqual([]);
});

const journeyMutants: Record<string, Record<string, string>> = {
  "dispatch returning business data directly": {
    "server.ts": server(`import { JourneyRunner } from "./src/trains/journey";`, `  void JourneyRunner; void mapping; void inputs; void context;
  return { selectedTrainId: "train:match:nominal" };`),
  },
  "dispatch constructing an inert JourneyRunner": {
    "server.ts": server(`import { JourneyRunner } from "./src/trains/journey";`, `  const journey = new JourneyRunner(mapping.path);
  journey.execute(action, inputs, context);
  return { selectedTrainId: "train:match:nominal" };`),
  },
  "JourneyRunner that never reaches InterlockingRunner": {
    "src/trains/journey.ts": `import { InterlockingRunner } from "./interlocking";

export class JourneyRunner {
  constructor(private readonly journeyPath: string) {}
  execute(_action: string, _inputs: object, _context: object) {
    void InterlockingRunner;
    return { selectedTrainId: "train:match:nominal" };
  }
}
`,
  },
  "JourneyRunner imported from a test-local module": {
    "server.ts": server(`import { JourneyRunner } from "./src/trains/journey.test";`, journeyReturn),
    "src/trains/journey.test.ts": journeySource,
  },
  "JourneyRunner imported from a spec-local module": {
    "server.ts": server(`import { JourneyRunner } from "./src/trains/journey.spec";`, journeyReturn),
    "src/trains/journey.spec.ts": journeySource,
  },
  "JourneyRunner imported from an unresolved module": {
    "server.ts": server(`import { JourneyRunner } from "./src/trains/missing-journey";`, journeyReturn),
  },
  "JourneyRunner imported from an external package": {
    "server.ts": server(`import { JourneyRunner } from "@consumer/journey";`, journeyReturn),
  },
};

for (const [name, files] of Object.entries(journeyMutants)) {
  test(`journey-mediated proof rejects ${name}`, async () => {
    expect(smoke(await mutant(files))).not.toEqual([]);
  });
}

test("each persisted dirty journey fixture fails the smoke rule on its own", async () => {
  for (const fixture of ["journey_mediated_direct_business", "journey_test_local_lookalike"]) {
    expect(smoke(await run(join(fixtures, "dirty", fixture))), fixture).not.toEqual([]);
  }
});
