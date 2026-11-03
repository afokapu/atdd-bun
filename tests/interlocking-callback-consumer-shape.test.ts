// URN: test:toolkit:interlocking-callback-consumer-shape:E001-UNIT-001-real-decision-consumer-shape
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";

// Minimal read-only reduction of the Decision response-request route tests at parent 9ff9a73dde0b
// (queue-request:95, refuse-request:78, replay-request:101, report-request-unavailability:96).
// Their detector-relevant shape, which fb27a284 alias-following does not recognize, is:
//   1. the local wrapper takes the deployment environment FIRST and the callback LAST:
//        async function withDeployment<T>(env, work: () => Promise<T>): Promise<T> { ... return await work(); ... }
//        const trainResult = await withDeployment(ENV, async () => { ...; return execution; });
//      (fb27a284 reads the callback as the wrapper's first parameter and the only call argument);
//   2. the production trace is asserted as a whole object on the alias, not field by field on a bound const:
//        expect(trainResult?.trace).toEqual({ interlockingId, routeId, selectedTrainId, routeCategory,
//                                             guardId, resolutionStrategy, resolutionReason });
// Only that exact shape may be recognized. Every nontransparent wrapper or callback and every partial,
// spread, negated, detached or non-callback whole-object assertion stays a finding.

// Each case spawns the detector subprocess; the looped cases exceed bun's default 5s test timeout on CI.
const TIMEOUT = 120_000;

const detector = resolve(import.meta.dir, "../detectors/bun_interlocking_coverage");
const RULE = "tester.bun.interlocking-trace-binds-declared-route";
const RUNNER = "tester.bun.interlocking-production-runner-used";

const IMPORTS = `import { InterlockingRunner } from "../../../convex/trains/interlocking";
import { TrainRunner } from "../../../convex/trains/runner";
`;

const TRACE_FIELDS = [
  ["interlockingId", "interlocking:match-resolution"],
  ["routeId", "alternate-timeout"],
  ["selectedTrainId", "train:match:match-resolution-timeout"],
  ["routeCategory", "alternate"],
  ["guardId", "guard:timer-expires"],
  ["resolutionStrategy", "fail_on_multiple_match"],
  ["resolutionReason", "guard guard:timer-expires held"],
] as const;

const literal = (skip?: string, extra = "") => `{
${extra}${TRACE_FIELDS.filter(([field]) => field !== skip).map(([field, value]) => `    ${field}: ${JSON.stringify(value)},\n`).join("")}  }`;

const whole = (subject = "trainResult?.trace", matcher = "toEqual", object = literal()) =>
  `  expect(${subject}).${matcher}(${object});\n`;

// The real wrapper: environment first, callback last, restoration in `finally`.
const REAL_WRAPPER = `async function withDeployment<T>(env: Readonly<Record<string, string>>, work: () => Promise<T>): Promise<T> {
  const prior = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    return await work();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
`;

// The unchanged fb27a284 shape: callback is the only parameter and the only argument.
const SINGLE_WRAPPER = `async function withDeployment<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } finally {
    // restore the deployment configuration
  }
}
`;

const RESOLVE = `  const runner = new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml");
  const resolution = await runner.resolveTrain("resolve_match", { timerExpired: true });
`;

// The real callback: handlers are loaded, the declared train executes, assertions run inside, and the
// execution itself is returned.
const REAL_CALLBACK = `async () => {
    const handlers = await responseHandlers();
    const execution = await new TrainRunner(resolution.trainPath, handlers).execute(resolution, inputs, {
      executionKey: "e2e:alternate-timeout:run-1",
    });
    expect(resolution.trainId).toBe("train:match:match-resolution-timeout");
    expect(execution?.status).toBe("completed");
    if (execution === null) throw new Error("expected a TrainRunner result");
    expect(resolution.routeId).toBe("alternate-timeout");
    return execution;
  }`;

const HELPERS = `const inputs = { authorization: "Bearer owner" };
async function responseHandlers(): Promise<Record<string, unknown>> { return {}; }
`;

const caseFile = (wrapper: string, call: string, assertions = whole()) => `${IMPORTS}
${HELPERS}${wrapper}
test("alternate-timeout trace binds the declared route", async () => {
${RESOLVE}${call}
${assertions}});
`;

const realCall = (callback = REAL_CALLBACK, args = (cb: string) => `{ SENDERS: "[]" }, ${cb}`) =>
  `  const trainResult: any = await withDeployment(${args(callback)});`;
const REAL_CALL = realCall();

async function findingsFor(source: string): Promise<{ trace: number; runner: number }> {
  const root = await mkdtemp(join(tmpdir(), "atdd-callback-consumer-"));
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

const flagged = (found: { trace: number; runner: number }) => found.trace > 0 || found.runner > 0;

test("the real Decision consumer shape (env-first wrapper, whole-object trace) is recognized", async () => {
  expect(await findingsFor(caseFile(REAL_WRAPPER, REAL_CALL))).toEqual({ trace: 0, runner: 0 });
}, TIMEOUT);

test("each half of the real shape is recognized on its own", async () => {
  // Env-first wrapper with the established per-field assertions on a bound const.
  const perField = `  const trace = trainResult?.trace;\n${TRACE_FIELDS.map(([field]) => `  expect(trace?.${field}).toBeTruthy();\n`).join("")}`;
  expect(await findingsFor(caseFile(REAL_WRAPPER, REAL_CALL, perField))).toEqual({ trace: 0, runner: 0 });
  // The single-parameter fb27a284 wrapper with the whole-object assertion.
  expect(await findingsFor(caseFile(SINGLE_WRAPPER, realCall(REAL_CALLBACK, (cb) => cb)))).toEqual({ trace: 0, runner: 0 });
}, TIMEOUT);

const NONTRANSPARENT_WRAPPERS: Record<string, string> = {
  "wrapper returns a fabricated value": `async function withDeployment<T>(env: Readonly<Record<string, string>>, work: () => Promise<T>): Promise<any> {
  await work();
  return { trace: ${literal()} };
}
`,
  "wrapper spreads over the callback result": `async function withDeployment<T>(env: Readonly<Record<string, string>>, work: () => Promise<T>): Promise<any> {
  return { ...(await work()), trace: ${literal()} };
}
`,
  "wrapper conditionally returns the callback result": `async function withDeployment<T>(env: Readonly<Record<string, string>>, work: () => Promise<T>): Promise<any> {
  return env.enabled ? await work() : { trace: ${literal()} };
}
`,
  "wrapper maps the callback result": `async function withDeployment<T>(env: Readonly<Record<string, string>>, work: () => Promise<T>): Promise<any> {
  return (await work(), { trace: ${literal()} });
}
`,
  "wrapper returns the environment instead of the callback result": `async function withDeployment<T>(env: any, work: () => Promise<T>): Promise<any> {
  await work();
  return env;
}
`,
  "wrapper reassigns the callback before calling it": `async function withDeployment<T>(env: Readonly<Record<string, string>>, work: () => Promise<T>): Promise<any> {
  work = async () => ({ trace: ${literal()} }) as any;
  return await work();
}
`,
};

const NONTRANSPARENT_CALLBACKS: Record<string, string> = {
  "callback returns a spread copy": `async () => ({ ...(await new TrainRunner(resolution.trainPath, {}).execute(resolution, inputs)), trace: ${literal()} })`,
  "callback discards the execution and returns a literal": `async () => {
    await new TrainRunner(resolution.trainPath, {}).execute(resolution, inputs);
    return { trace: ${literal()} };
  }`,
  "callback returns the execution only on one branch": `async () => {
    const execution = await new TrainRunner(resolution.trainPath, {}).execute(resolution, inputs);
    if (resolution.routeId === "never") return execution;
    return { trace: ${literal()} };
  }`,
  "callback executes a different train than the resolution": `async () => new TrainRunner("train:unrelated", {}).execute(resolution, inputs)`,
};

// The resolution assertions the real callback carries, so only the trace/provenance rules can fire.
const RESOLUTION_ASSERTIONS = `  expect(resolution.trainId).toBe("train:match:match-resolution-timeout");\n`;

test("nontransparent wrappers and callbacks stay findings in the env-first shape", async () => {
  const result: Record<string, boolean> = {};
  for (const [label, wrapper] of Object.entries(NONTRANSPARENT_WRAPPERS)) {
    result[label] = flagged(await findingsFor(caseFile(wrapper, REAL_CALL, RESOLUTION_ASSERTIONS + whole())));
  }
  for (const [label, callback] of Object.entries(NONTRANSPARENT_CALLBACKS)) {
    result[label] = flagged(await findingsFor(caseFile(REAL_WRAPPER, realCall(callback), RESOLUTION_ASSERTIONS + whole())));
  }
  expect(result).toEqual(Object.fromEntries(Object.keys(result).map((label) => [label, true])));
}, TIMEOUT);

test("the callback must be the argument the wrapper actually invokes", async () => {
  const swapped = flagged(await findingsFor(caseFile(REAL_WRAPPER, realCall(REAL_CALLBACK, (cb) => `${cb}, { SENDERS: "[]" }`))));
  const missingEnv = flagged(await findingsFor(caseFile(REAL_WRAPPER, realCall(REAL_CALLBACK, (cb) => cb))));
  const extraArgument = flagged(await findingsFor(caseFile(REAL_WRAPPER, realCall(REAL_CALLBACK, (cb) => `{ SENDERS: "[]" }, ${cb}, "extra"`))));
  expect({ swapped, missingEnv, extraArgument }).toEqual({ swapped: true, missingEnv: true, extraArgument: true });
}, TIMEOUT);

test("a whole-object trace assertion must be complete, positive, literal and about the alias", async () => {
  const cases: Record<string, string> = {
    "a required field is missing": RESOLUTION_ASSERTIONS + whole("trainResult?.trace", "toEqual", literal("guardId")),
    "the object spreads another value": RESOLUTION_ASSERTIONS + whole("trainResult?.trace", "toEqual", literal(undefined, "    ...base,\n")),
    "the assertion is negated": RESOLUTION_ASSERTIONS + whole("trainResult?.trace", "not.toEqual"),
    "the trace is read from a different object": `  const other: any = { trace: {} };\n${RESOLUTION_ASSERTIONS}${whole("other?.trace")}`,
    "the object is not a literal": `  const expected: any = ${literal()};\n${RESOLUTION_ASSERTIONS}${whole("trainResult?.trace", "toEqual", "expected")}`,
    "the object is not about the trace": RESOLUTION_ASSERTIONS + whole("trainResult?.status"),
    "there is no trace assertion at all": RESOLUTION_ASSERTIONS,
  };
  const result: Record<string, boolean> = {};
  for (const [label, assertions] of Object.entries(cases)) {
    // No other trace-shaped text exists in the file, so these only see the whole-object form.
    const source = caseFile(REAL_WRAPPER, REAL_CALL, assertions.includes("trace") ? assertions : `${assertions}  const trace = trainResult?.trace;\n`);
    result[label] = flagged(await findingsFor(source));
  }
  expect(result).toEqual(Object.fromEntries(Object.keys(result).map((label) => [label, true])));
}, TIMEOUT);

test("a whole-object trace assertion is only recognized through a callback return alias", async () => {
  const direct = `  const trainResult: any = await new TrainRunner(resolution.trainPath, {}).execute(resolution, inputs);\n`;
  expect(flagged(await findingsFor(caseFile(REAL_WRAPPER, direct, RESOLUTION_ASSERTIONS + whole())))).toBe(true);
}, TIMEOUT);
