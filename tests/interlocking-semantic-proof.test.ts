import { expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";

const detector = resolve(import.meta.dir, "../detectors/bun_interlocking_coverage");
const run = (root: string) => runImplementation("bun_interlocking_coverage", {
  scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"],
});
const rule = (id: string, findings: Awaited<ReturnType<typeof run>>) => findings.filter((v) => v.rule_id === id);

test("semantic proof rejects runner tokens, fabricated traces, and route literals disconnected from production execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-semantic-false-green-"));
  try {
    await cp(join(detector, "fixtures", "clean", "interlocking_production_runner"), root, { recursive: true });
    const routes = join(root, "e2e", "interlockings", "match-resolution", "routes.test.ts");
    const trace = join(root, "e2e", "interlockings", "match-resolution", "trace.test.ts");
    const smoke = join(root, "e2e", "smoke", "resolve-match.smoke.test.ts");

    // These are intentionally truthful mutants: every old discovery token remains, but no asserted
    // value flows from InterlockingRunner resolution into TrainRunner execution.
    await writeFile(routes, `import { InterlockingRunner } from "../../../convex/trains/interlocking";
import { TrainRunner } from "../../../convex/trains/runner";
const unused = new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml");
new TrainRunner("train:unrelated").execute({});
test("route names are merely restated", () => {
  expect("nominal-all-voted").toBe("nominal-all-voted");
  expect("train:match:match-resolution-standard").toBe("train:match:match-resolution-standard");
  expect("alternate-timeout").toBe("alternate-timeout");
  expect("train:match:match-resolution-timeout").toBe("train:match:match-resolution-timeout");
  expect(unused).toBeDefined();
});
`);
    await writeFile(trace, `import { InterlockingRunner } from "../../../convex/trains/interlocking";
import { TrainRunner } from "../../../convex/trains/runner";
const runner = new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml");
const result = new TrainRunner("train:unrelated").execute({});
test("fabricated trace", () => {
  const trace = { interlockingId: "interlocking:match-resolution", routeId: "alternate-timeout", selectedTrainId: "train:match:match-resolution-timeout", routeCategory: "alternate", guardId: "guard:timer-expires", resolutionStrategy: "fail_on_multiple_match", resolutionReason: "made up" };
  expect(trace.interlockingId).toBeDefined(); expect(trace.routeId).toBeDefined();
  expect(trace.selectedTrainId).toBeDefined(); expect(trace.routeCategory).toBeDefined();
  expect(trace.guardId).toBeDefined(); expect(trace.resolutionStrategy).toBeDefined();
  expect(trace.resolutionReason).toBeDefined(); expect(runner).toBeDefined(); expect(result).toBeDefined();
});
`);
    await writeFile(smoke, `// Phase: SMOKE
import { StationMaster } from "../../convex/app";
import { InterlockingRunner } from "../../convex/trains/interlocking";
import { TrainRunner } from "../../convex/trains/runner";
test("smoke only names the path", () => {
  const stationMaster: any = {} as StationMaster;
  const result = { selectedTrainId: "train:match:match-resolution-standard" };
  expect(result.selectedTrainId).toBe("train:match:match-resolution-standard");
  expect(InterlockingRunner).toBeDefined(); expect(TrainRunner).toBeDefined(); expect(stationMaster).toBeDefined();
});
`);

    const findings = await run(root);
    expect(rule("tester.bun.interlocking-production-runner-used", findings)).not.toEqual([]);
    expect(rule("tester.bun.interlocking-route-coverage", findings)).not.toEqual([]);
    expect(rule("tester.bun.interlocking-trace-binds-declared-route", findings)).not.toEqual([]);
    expect(rule("tester.bun.interlocking-smoke-coverage-for-station-master", findings)).not.toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic smoke rejects a target token when dispatch invokes another action", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-mismatched-station-action-"));
  try {
    await cp(join(detector, "fixtures", "clean", "interlocking_smoke_coverage"), root, { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "server.ts"), `import { InterlockingRunner } from "./trains/interlocking";
import { TrainRunner } from "./trains/runner";
const runner = new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml");
export async function dispatch(action: string, inputs: object) {
  const resolution = runner.resolveTrain(action, inputs);
  return await new TrainRunner(resolution.trainId).execute({});
}
`);
    await writeFile(join(root, "e2e", "smoke", "resolve-match.smoke.test.ts"), `// Phase: SMOKE
import { expect, test } from "bun:test";
import { dispatch } from "../../src/server";
import { InterlockingRunner } from "../../convex/trains/interlocking";
import { TrainRunner } from "../../convex/trains/runner";
test("resolve_match smoke mentions the target but dispatches another action", async () => {
  const result = await dispatch("resolve_other", { allPlayersVoted: true });
  expect(result.selectedTrainId).toBe("train:match:match-resolution-standard");
  expect(InterlockingRunner).toBeDefined(); expect(TrainRunner).toBeDefined();
});
`);
    const findings = await run(root);
    expect(rule("tester.bun.interlocking-smoke-coverage-for-station-master", findings)).not.toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic proof rejects a literal sequence that is not derived from TrainRunner execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-sequence-false-green-"));
  try {
    await mkdir(join(root, "plan", "_trains", "_interlockings"), { recursive: true });
    await mkdir(join(root, "e2e", "interlockings"), { recursive: true });
    await writeFile(join(root, "plan", "_trains", "_interlockings", "route.yaml"), `interlocking_id: interlocking:proof\nroutes:\n  - route_id: nominal\n    train_id: train:proof:nominal\n`);
    await writeFile(join(root, "plan", "_trains", "nominal.yaml"), `train_id: train:proof:nominal\nsequence:\n  - from: user:actor\n    to: wagon:first\n  - from: wagon:first\n    to: wagon:last\n`);
    await writeFile(join(root, "e2e", "interlockings", "sequence.test.ts"), `import { expect, test } from "bun:test";
test("literal sequence", () => {
  const sequence = ["wagon:first", "wagon:last"];
  expect(sequence).toEqual(["wagon:first", "wagon:last"]);
  expect("train:proof:nominal").toBeDefined();
});
`);
    const findings = await run(root);
    expect(rule("tester.bun.interlocking-train-sequence-is-exercised", findings)).not.toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic proof accepts Bun mutation witnesses from the selected TrainRunner result", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-sequence-mutation-proof-"));
  try {
    await mkdir(join(root, "plan", "_trains", "_interlockings"), { recursive: true });
    await mkdir(join(root, "e2e", "interlockings"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "interlocking.ts"), "export class InterlockingRunner {}\n");
    await writeFile(join(root, "src", "runner.ts"), "export class TrainRunner {}\n");
    await writeFile(join(root, "plan", "_trains", "_interlockings", "route.yaml"), `interlocking_id: interlocking:proof\nroutes:\n  - route_id: nominal\n    train_id: train:proof:nominal\n`);
    await writeFile(join(root, "plan", "_trains", "nominal.yaml"), `train_id: train:proof:nominal\nsequence:\n  - from: user:actor\n    to: wagon:first\n  - from: wagon:first\n    to: wagon:last\n`);
    await writeFile(join(root, "e2e", "interlockings", "sequence.test.ts"), `import { expect, test } from "bun:test";
import { InterlockingRunner } from "../../src/interlocking";
import { TrainRunner } from "../../src/runner";
test("selected train proves order, handoff, and final wagon", () => {
  const resolution = new InterlockingRunner("plan/_trains/_interlockings/route.yaml").resolveTrain("nominal", {});
  const result = new TrainRunner(resolution.trainId).execute({});
  expect(resolution.trainId).toBe("train:proof:nominal");
  expect(result.steps).toEqual([{ from: "user:actor", to: "wagon:first" }, { from: "wagon:first", to: "wagon:last" }]);
  expect(result.steps).toContainEqual(expect.objectContaining({ from: "wagon:first", to: "wagon:last" }));
  expect(result.steps.at(-1)).toEqual(expect.objectContaining({ to: "wagon:last" }));
});
`);
    const findings = await run(root);
    expect(rule("tester.bun.interlocking-train-sequence-is-exercised", findings)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic proof accepts an awaited TrainRunner execution result", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-awaited-runner-proof-"));
  try {
    await mkdir(join(root, "plan", "_trains", "_interlockings"), { recursive: true });
    await mkdir(join(root, "e2e", "interlockings"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "interlocking.ts"), "export class InterlockingRunner {}\n");
    await writeFile(join(root, "src", "runner.ts"), "export class TrainRunner {}\n");
    await writeFile(join(root, "plan", "_trains", "_interlockings", "route.yaml"), `interlocking_id: interlocking:async-proof\nroutes:\n  - route_id: nominal\n    train_id: train:async-proof:nominal\n`);
    await writeFile(join(root, "plan", "_trains", "nominal.yaml"), `train_id: train:async-proof:nominal\nsequence:\n  - from: user:actor\n    to: wagon:first\n  - from: wagon:first\n    to: wagon:last\n`);
    await writeFile(join(root, "e2e", "interlockings", "awaited.test.ts"), `import { expect, test } from "bun:test";
import { InterlockingRunner } from "../../src/interlocking";
import { TrainRunner } from "../../src/runner";
test("awaited production execution", async () => {
  const resolution = new InterlockingRunner("plan/_trains/_interlockings/route.yaml").resolveTrain("nominal", {});
  const execution = await new TrainRunner(resolution.trainId).execute({});
  expect(resolution.trainId).toBe("train:async-proof:nominal");
  expect(execution.steps).toEqual([{ from: "user:actor", to: "wagon:first" }, { from: "wagon:first", to: "wagon:last" }]);
  expect(execution.steps).toContainEqual(expect.objectContaining({ from: "wagon:first", to: "wagon:last" }));
  expect(execution.steps.at(-1)).toEqual(expect.objectContaining({ to: "wagon:last" }));
});
`);
    const findings = await run(root);
    for (const id of [
      "tester.bun.interlocking-production-runner-used",
      "tester.bun.interlocking-route-coverage",
      "tester.bun.interlocking-train-sequence-is-exercised",
    ]) expect(rule(id, findings)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic smoke accepts a functional Station Master module with an asserted dispatch result", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-functional-station-smoke-"));
  try {
    await cp(join(detector, "fixtures", "clean", "interlocking_smoke_coverage"), root, { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "server.ts"), `import { InterlockingRunner } from "./trains/interlocking";
import { TrainRunner } from "./trains/runner";
const runner = new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml");
export async function dispatch(action: string, inputs: object) {
  const resolution = runner.resolveTrain(action, inputs);
  return await new TrainRunner(resolution.trainId).execute({});
}
`);
    await writeFile(join(root, "e2e", "smoke", "resolve-match.smoke.test.ts"), `// Phase: SMOKE
import { expect, test } from "bun:test";
import { dispatch } from "../../src/server";
import { InterlockingRunner } from "../../convex/trains/interlocking";
import { TrainRunner } from "../../convex/trains/runner";
test("resolve_match functional Station Master smoke", async () => {
  const result = await dispatch("resolve_match", { allPlayersVoted: true });
  expect(result.selectedTrainId).toBe("train:match:match-resolution-standard");
  expect(InterlockingRunner).toBeDefined(); expect(TrainRunner).toBeDefined();
});
`);
    const findings = await run(root);
    expect(rule("tester.bun.interlocking-smoke-coverage-for-station-master", findings)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic smoke rejects an exported dispatch disconnected from an inert production helper", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-inert-station-helper-"));
  try {
    await cp(join(detector, "fixtures", "clean", "interlocking_smoke_coverage"), root, { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "server.ts"), `import { InterlockingRunner } from "./trains/interlocking";
import { TrainRunner } from "./trains/runner";
const runner = new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml");
async function inertProductionHelper(action: string, inputs: object) {
  const resolution = runner.resolveTrain(action, inputs);
  return await new TrainRunner(resolution.trainId).execute({});
}
export async function dispatch(_action: string, _inputs: object) {
  return { selectedTrainId: "train:match:match-resolution-standard" };
}
`);
    await writeFile(join(root, "e2e", "smoke", "resolve-match.smoke.test.ts"), `// Phase: SMOKE
import { expect, test } from "bun:test";
import { dispatch } from "../../src/server";
import { InterlockingRunner } from "../../convex/trains/interlocking";
import { TrainRunner } from "../../convex/trains/runner";
test("resolve_match dispatch does not use the inert helper", async () => {
  const result = await dispatch("resolve_match", { allPlayersVoted: true });
  expect(result.selectedTrainId).toBe("train:match:match-resolution-standard");
  expect(InterlockingRunner).toBeDefined(); expect(TrainRunner).toBeDefined();
});
`);
    const findings = await run(root);
    expect(rule("tester.bun.interlocking-smoke-coverage-for-station-master", findings)).not.toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
