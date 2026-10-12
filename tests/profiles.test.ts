import { expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaultProfiles, enabledProfiles, enforce, profileNames } from "../src/enforce";
import { runHook } from "../src/hooks";
import { loosenedPolicy } from "../src/integrity";

// The operator decides what atdd-bun enforces: every profile by default, or the list in atdd-bun.yaml.
const repo = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), "atdd-profiles-"));
  for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
  return root;
};
const git = async (root: string, ...args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); await child.exited; };
// One traceability defect (an acceptance no test binds) and one coder defect (a source file with no header).
const TRACE = { "plan/orders/E001.yaml": "urn: wmbt:orders:E001\nacceptances:\n  - identity:\n      urn: acc:orders:E001-UNIT-001\n" };
const CODER = { "src/wagons/orders/features/a/domain/thing.ts": "export const thing = 1;\n" };
const rules = async (root: string, profiles?: Parameters<typeof enforce>[0]["profiles"]) => [...new Set((await enforce({ root, profiles })).map(v => v.rule_id.split(".")[0]))].sort();

test("by default every built-in profile is activated", async () => {
  const root = await repo({ ...TRACE, ...CODER });
  expect(await enabledProfiles(root)).toEqual(defaultProfiles);
  expect(await enabledProfiles(root)).not.toContain("flow");
  expect(await rules(root)).toEqual(expect.arrayContaining(["coder", "traceability"]));
}, 30_000);

test("the optional flow profile is available only by explicit adoption", async () => {
  const root = await repo({ "atdd-bun.yaml": "profiles: [flow]\n" });
  expect(await enabledProfiles(root)).toEqual(["flow"]);
  expect(await enforce({ root, profiles: ["flow"] })).toEqual([]);
});

test("legacy workflow configuration normalizes to canonical flow without weakening unknown-profile validation", async () => {
  const root = await repo({ "atdd-bun.yaml": "profiles: [workflow]\n" });
  expect(await enabledProfiles(root)).toEqual(["flow"]);
  expect(await enforce({ root, profiles: ["all"] })).toEqual(await enforce({ root, profiles: ["flow"] }));
  await writeFile(join(root, "atdd-bun.yaml"), "profiles: [workflow, not-a-profile]\n");
  await expect(enforce({ root })).rejects.toThrow("unknown profile(s): not-a-profile");
});

test("retired delivery and workflow profiles may migrate only to flow", () => {
  expect(loosenedPolicy({ profiles: ["delivery"] }, { profiles: ["flow"] })).toEqual([]);
  expect(loosenedPolicy({ profiles: ["workflow"] }, { profiles: ["flow"] })).toEqual([]);
  expect(loosenedPolicy({ profiles: ["delivery", "security"] }, { profiles: ["flow"] })).toEqual(["profiles drops security"]);
  expect(loosenedPolicy({ profiles: ["delivery"] }, { profiles: ["docs"] })).toEqual(["profiles drops delivery"]);
  expect(loosenedPolicy({ profiles: ["delivery"] }, {})).toEqual(["profiles becomes implicit: the explicit list [delivery] was removed"]);
});

test("all runs only the profiles the operator lists; a named profile still runs on request", async () => {
  const root = await repo({ ...TRACE, ...CODER, "atdd-bun.yaml": "profiles: [traceability]\n" });
  expect(await enabledProfiles(root)).toEqual(["traceability"]);
  expect(await rules(root, ["all"])).toEqual(["traceability"]);
  expect(await rules(root)).toEqual(["traceability"]);
  expect(await rules(root, ["coder"])).toContain("coder");
});

test("an unknown profile name or an empty list is an error, never a silent run of nothing", async () => {
  for (const config of ["profiles: [traceabilty]\n", "profiles: []\n", "profiles: traceability\n"]) {
    const root = await repo({ ...TRACE, "atdd-bun.yaml": config });
    await expect(enforce({ root }), config).rejects.toThrow("atdd-bun.yaml profiles");
    await expect(enforce({ root, profiles: ["coder"] }), `${config} (explicit profile)`).rejects.toThrow("atdd-bun.yaml profiles");
  }
  const root = await repo({ ...TRACE, "atdd-bun.yaml": "profiles: [nope]\n" });
  const child = Bun.spawn({ cmd: [process.execPath, resolve(import.meta.dir, "../src/cli.ts"), "all"], cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(await child.exited).not.toBe(0);
});

test("deactivating an explicitly adopted profile is reported as loosening atdd-bun.yaml; activating one is not", () => {
  expect(loosenedPolicy({ profiles: ["traceability", "planner"] }, { profiles: ["traceability"] })).toEqual(["profiles drops planner"]);
  expect(loosenedPolicy({ profiles: ["traceability"] }, { profiles: ["traceability", "coder"] })).toEqual([]);
  // The brownfield adoption cases (absent → explicit, explicit → absent) are in brownfield-adoption.test.ts.
});

test("hooks enforce only the activated profiles", async () => {
  const root = await repo({ ...CODER, "atdd-bun.yaml": "profiles: [traceability]\n" });
  await git(root, "init", "-q", "-b", "work");
  await git(root, "add", "-A");
  expect(await runHook("pre-commit", root)).toMatchObject({ ok: true });
  await writeFile(join(root, "atdd-bun.yaml"), "profiles: [coder]\n"); await git(root, "add", "-A");
  expect((await runHook("pre-commit", root)).ok).toBeFalse();
});

// Detector concurrency is resource control, never verification: a run starts at most ATDD_BUN_MAX_DETECTORS detector
// processes, and all atdd-bun runs on the host share ATDD_BUN_HOST_DETECTORS slots. Concurrency is counted by a fake
// Bun.spawn whose children stay alive until released; tests use a private slot directory, never the host's.
const realSpawn = Bun.spawn.bind(Bun);
const withEnv = async <T>(vars: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> => {
  const saved = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) value === undefined ? delete process.env[key] : process.env[key] = value;
  try { return await run(); } finally { for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value; }
};
/** Replace detector processes with counted fakes. A fake exits once more children are live than `cap` allows (the
 * overflow is recorded) or after a short hold; the hold only yields, nothing asserts on elapsed time. */
const countDetectors = (cap: number) => {
  const live = { now: 0, peak: 0, started: 0 }, held: Array<() => void> = [];
  const spy = spyOn(Bun, "spawn").mockImplementation(((options: Parameters<typeof Bun.spawn>[0]) => {
    const { cmd, env } = options as { cmd: string[]; env: Record<string, string> };
    if (!cmd.at(-1)?.endsWith("detect.mjs")) return realSpawn(options as never);
    live.now++; live.started++; live.peak = Math.max(live.peak, live.now);
    const release = new Promise<void>(done => { held.push(done); setTimeout(done, 15); });
    if (live.now > cap) held.splice(0).forEach(done => done());
    const exited = (async () => {
      await writeFile(env.ATDD_VIOLATIONS_REPORT, JSON.stringify({ violations: [] }));
      await release; live.now--; return 0;
    })();
    return { exited, stderr: new Response("").body } as never;
  }) as typeof Bun.spawn);
  return { live, restore: () => spy.mockRestore() };
};
const slotsDir = () => mkdtemp(join(tmpdir(), "atdd-detector-slots-"));

test("one run starts at most ATDD_BUN_MAX_DETECTORS detector processes at once", async () => {
  const root = await repo({ ...CODER });
  const counted = countDetectors(2);
  try {
    await withEnv({ ATDD_BUN_MAX_DETECTORS: "2", ATDD_BUN_HOST_DETECTORS: "64", ATDD_BUN_DETECTOR_SLOTS_DIR: await slotsDir() }, () => enforce({ root, profiles: ["coder"] }));
  } finally { counted.restore(); }
  expect(counted.live.started).toBe(7);
  expect(counted.live.peak).toBe(2);
});

test("concurrent runs on one host share ATDD_BUN_HOST_DETECTORS slots", async () => {
  const root = await repo({ ...CODER }), slots = await slotsDir();
  const counted = countDetectors(3);
  try {
    await withEnv({ ATDD_BUN_MAX_DETECTORS: "3", ATDD_BUN_HOST_DETECTORS: "3", ATDD_BUN_DETECTOR_SLOTS_DIR: slots }, () =>
      Promise.all([enforce({ root, profiles: ["coder"] }), enforce({ root, profiles: ["coder"] })]));
  } finally { counted.restore(); }
  expect(counted.live.started).toBe(14);
  expect(counted.live.peak).toBe(3);
  expect(await readdir(slots)).toEqual([]);
});

test("a host slot held by a dead process is reclaimed", async () => {
  const root = await repo({ ...CODER }), slots = await slotsDir();
  const dead = realSpawn({ cmd: [process.execPath, "-e", ""] }); await dead.exited;
  for (const slot of [0, 1]) await writeFile(join(slots, `slot-${slot}`), String(dead.pid));
  const counted = countDetectors(2);
  try {
    await withEnv({ ATDD_BUN_MAX_DETECTORS: "2", ATDD_BUN_HOST_DETECTORS: "2", ATDD_BUN_DETECTOR_SLOTS_DIR: slots }, () => enforce({ root, profiles: ["coder"] }));
  } finally { counted.restore(); }
  expect(counted.live.started).toBe(7);
  expect(await readdir(slots)).toEqual([]);
});

test("an unusable slot directory falls back to the per-run cap and says so on stderr", async () => {
  const root = await repo({ ...CODER }), notADirectory = join(await slotsDir(), "file");
  await writeFile(notADirectory, "");
  const counted = countDetectors(2), stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await withEnv({ ATDD_BUN_MAX_DETECTORS: "2", ATDD_BUN_HOST_DETECTORS: "1", ATDD_BUN_DETECTOR_SLOTS_DIR: notADirectory }, () => enforce({ root, profiles: ["coder"] }));
  } finally { counted.restore(); stderr.mockRestore(); }
  expect(counted.live.started).toBe(7);
  expect(counted.live.peak).toBe(2);
  expect(stderr.mock.calls.map(([text]) => String(text)).join("")).toContain("per-run cap only");
});

test("an invalid detector concurrency setting fails closed", async () => {
  const root = await repo({ ...CODER });
  for (const [key, value] of [["ATDD_BUN_MAX_DETECTORS", "0"], ["ATDD_BUN_MAX_DETECTORS", "two"], ["ATDD_BUN_HOST_DETECTORS", "-1"], ["ATDD_BUN_HOST_DETECTORS", "1.5"]]) {
    await expect(withEnv({ [key]: value, ATDD_BUN_DETECTOR_SLOTS_DIR: await slotsDir() }, () => enforce({ root, profiles: ["coder"] })), `${key}=${value}`).rejects.toThrow(`${key} must be a positive integer`);
  }
});

test("capping detector concurrency leaves the findings of a fixture run unchanged", async () => {
  const root = await repo({ ...TRACE, ...CODER }), slots = await slotsDir();
  const run = (max: string | undefined) => withEnv({ ATDD_BUN_MAX_DETECTORS: max, ATDD_BUN_DETECTOR_SLOTS_DIR: slots }, () => enforce({ root, profiles: ["traceability", "coder"] }));
  const serial = await run("1");
  expect(serial.length).toBeGreaterThan(0);
  expect(await run(undefined)).toEqual(serial);
}, 60_000);
