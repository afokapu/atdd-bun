// URN: test:toolkit:interlocking-callback-alias:E001-UNIT-001-transparent-callback-return-alias
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";

// Decision response-request route tests execute the production chain inside a deployment wrapper:
//   const outer = await withDeployment(env, async () => new TrainRunner(...).execute(resolution, ...));
// The callback returns the direct execution unchanged and the wrapper returns the callback's value
// unchanged, so `outer` IS the direct execution and `outer.trace` is the production trace. Only that
// exact transparent shape may alias the inner execution; every other wrapper or callback is a
// fabrication channel and must stay rejected.

const detector = resolve(import.meta.dir, "../detectors/bun_interlocking_coverage");
const RULE = "tester.bun.interlocking-trace-binds-declared-route";
const RUNNER = "tester.bun.interlocking-production-runner-used";

const IMPORTS = `import { InterlockingRunner } from "../../../convex/trains/interlocking";
import { TrainRunner } from "../../../convex/trains/runner";
`;

const ASSERTIONS = `  const trace = outer.trace;
  expect(trace.interlockingId).toBe("interlocking:match-resolution");
  expect(trace.routeId).toBe("alternate-timeout");
  expect(trace.selectedTrainId).toBe("train:match:match-resolution-timeout");
  expect(trace.routeCategory).toBe("alternate");
  expect(trace.guardId).toBe("guard:timer-expires");
  expect(trace.resolutionStrategy).toBe("fail_on_multiple_match");
  expect(trace.resolutionReason).toBeTruthy();
`;

const TRANSPARENT_WRAPPER = `async function withDeployment<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } finally {
    // restore the deployment configuration
  }
}
`;

const RESOLVE = `  const runner = new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml");
  const resolution = runner.resolveTrain("resolve_match", { timerExpired: true });
`;

const caseFile = (wrapper: string, call: string, assertions = ASSERTIONS) => `${IMPORTS}
${wrapper}
test("alternate-timeout trace binds the declared route", async () => {
${RESOLVE}${call}
${assertions}});
`;

const EXPRESSION_CALLBACK = `  const outer: any = await withDeployment(async () => new TrainRunner(resolution.trainId).execute({}));`;

async function findingsFor(source: string): Promise<{ trace: number; runner: number }> {
  const root = await mkdtemp(join(tmpdir(), "atdd-callback-alias-"));
  try {
    await cp(join(detector, "fixtures", "clean", "interlocking_production_runner"), root, { recursive: true });
    await writeFile(join(root, "e2e", "interlockings", "match-resolution", "trace.test.ts"), source);
    const findings = await runImplementation("bun_interlocking_coverage", {
      scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"],
    });
    const trace = join("e2e", "interlockings", "match-resolution", "trace.test.ts");
    const onTrace = findings.filter((v) => v.file === trace);
    return {
      trace: onTrace.filter((v) => v.rule_id === RULE).length,
      runner: onTrace.filter((v) => v.rule_id === RUNNER).length,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a transparent callback return alias follows the inner production execution", async () => {
  const expression = await findingsFor(caseFile(TRANSPARENT_WRAPPER, EXPRESSION_CALLBACK));
  expect(expression).toEqual({ trace: 0, runner: 0 });

  const block = await findingsFor(caseFile(TRANSPARENT_WRAPPER, `  const outer: any = await withDeployment(async () => {
    const inner = await new TrainRunner(resolution.trainId).execute({});
    return inner;
  });`));
  expect(block).toEqual({ trace: 0, runner: 0 });

  const direct = await findingsFor(caseFile(TRANSPARENT_WRAPPER, `  const outer: any = await withDeployment(async () => {
    return new TrainRunner(resolution.trainId).execute({});
  });`));
  expect(direct).toEqual({ trace: 0, runner: 0 });
});

test("a transparent alias keeps exact trace field recognition", async () => {
  const partial = ASSERTIONS.replace(/  expect\(trace\.guardId\).*\n/, "");
  const found = await findingsFor(caseFile(TRANSPARENT_WRAPPER, EXPRESSION_CALLBACK, partial));
  expect(found.trace).toBeGreaterThan(0);
});

const NONTRANSPARENT: Record<string, [string, string]> = {
    "wrapper returns a fabricated value": [
      `async function withDeployment<T>(work: () => Promise<T>): Promise<any> {
  await work();
  return { trace: { interlockingId: "interlocking:match-resolution" } };
}
`, EXPRESSION_CALLBACK],
    "wrapper spreads over the callback result": [
      `async function withDeployment<T>(work: () => Promise<T>): Promise<any> {
  return { ...(await work()), trace: { interlockingId: "interlocking:match-resolution" } };
}
`, EXPRESSION_CALLBACK],
    "wrapper conditionally returns the callback result": [
      `async function withDeployment<T>(work: () => Promise<T>, enabled = false): Promise<any> {
  return enabled ? await work() : { trace: {} };
}
`, EXPRESSION_CALLBACK],
    "wrapper maps the callback result": [
      `async function withDeployment<T>(work: () => Promise<T>): Promise<any> {
  return (await work(), { trace: { interlockingId: "interlocking:match-resolution" } });
}
`, EXPRESSION_CALLBACK],
    "callback returns a spread copy": [
      TRANSPARENT_WRAPPER,
      `  const outer: any = await withDeployment(async () => ({ ...(await new TrainRunner(resolution.trainId).execute({})), trace: {} }));`,
    ],
    "callback discards the execution and returns a literal": [
      TRANSPARENT_WRAPPER,
      `  const outer: any = await withDeployment(async () => {
    await new TrainRunner(resolution.trainId).execute({});
    return { trace: { interlockingId: "interlocking:match-resolution" } };
  });`,
    ],
    "callback returns the execution only on one branch": [
      TRANSPARENT_WRAPPER,
      `  const outer: any = await withDeployment(async () => {
    const inner = await new TrainRunner(resolution.trainId).execute({});
    if (resolution.routeId === "never") return inner;
    return { trace: { interlockingId: "interlocking:match-resolution" } };
  });`,
    ],
    "callback executes a different train than the resolution": [
      TRANSPARENT_WRAPPER,
      `  const outer: any = await withDeployment(async () => new TrainRunner("train:unrelated").execute({}));`,
    ],
};

async function flaggedLabels(assertions: string): Promise<Record<string, boolean>> {
  const flagged: Record<string, boolean> = {};
  for (const [label, [wrapper, call]] of Object.entries(NONTRANSPARENT)) {
    const found = await findingsFor(caseFile(wrapper, call, assertions));
    flagged[label] = found.trace > 0 || found.runner > 0;
  }
  return flagged;
}

const allFlagged = () => Object.fromEntries(Object.keys(NONTRANSPARENT).map((label) => [label, true]));

test("nontransparent wrappers and callbacks do not alias the inner execution", async () => {
  expect(await flaggedLabels(ASSERTIONS)).toEqual(allFlagged());
});

// The real Decision witness reads the trace through optional chains: `const trace = outer?.trace` and
// `expect(trace?.field)`. A transparent optional member read is the same member read; calls, writes,
// and every nontransparent alias stay rejected.
const OPTIONAL_ASSERTIONS = ASSERTIONS.replace("outer.trace", "outer?.trace").replace(/trace\./g, "trace?.");
const DIRECT_EXECUTION = `  const outer: any = await new TrainRunner(resolution.trainId).execute({});`;

test("optional-chain trace reads follow a transparent alias and a direct execution", async () => {
  expect(OPTIONAL_ASSERTIONS).toContain("outer?.trace");
  expect(OPTIONAL_ASSERTIONS).toContain("trace?.guardId");
  expect(await findingsFor(caseFile(TRANSPARENT_WRAPPER, EXPRESSION_CALLBACK, OPTIONAL_ASSERTIONS))).toEqual({ trace: 0, runner: 0 });
  expect(await findingsFor(caseFile(TRANSPARENT_WRAPPER, DIRECT_EXECUTION, OPTIONAL_ASSERTIONS))).toEqual({ trace: 0, runner: 0 });
  const mixed = ASSERTIONS.replace("outer.trace", "outer?.trace");
  expect(await findingsFor(caseFile(TRANSPARENT_WRAPPER, DIRECT_EXECUTION, mixed))).toEqual({ trace: 0, runner: 0 });
});

test("optional-chain reads keep exact trace field recognition", async () => {
  const partial = OPTIONAL_ASSERTIONS.replace(/  expect\(trace\?\.guardId\).*\n/, "");
  expect((await findingsFor(caseFile(TRANSPARENT_WRAPPER, DIRECT_EXECUTION, partial))).trace).toBeGreaterThan(0);
});

test("optional-chain reads keep every nontransparent alias rejected", async () => {
  expect(await flaggedLabels(OPTIONAL_ASSERTIONS)).toEqual(allFlagged());
});

test("an optional-chain read of a different object is not the production trace", async () => {
  const detached = `${DIRECT_EXECUTION}\n  const other: any = { trace: {} };`;
  const found = await findingsFor(caseFile(TRANSPARENT_WRAPPER, detached, OPTIONAL_ASSERTIONS.replace("outer?.trace", "other?.trace")));
  expect(found.trace).toBeGreaterThan(0);
});

test("an optional-chain call on the resolution still rebinds it before execution", async () => {
  // The declaration form (constructed from resolution.trainPath) is the one that checks rebinding.
  const declaration = `  const outer: any = await new TrainRunner(resolution.trainPath).execute(resolution);`;
  const clean = await findingsFor(caseFile(TRANSPARENT_WRAPPER, declaration, OPTIONAL_ASSERTIONS));
  expect(clean).toEqual({ trace: 0, runner: 0 });
  const mutated = `  resolution?.retarget();\n${declaration}`;
  const found = await findingsFor(caseFile(TRANSPARENT_WRAPPER, mutated, OPTIONAL_ASSERTIONS));
  expect(found.trace > 0 || found.runner > 0).toBe(true);
});
