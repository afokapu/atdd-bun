import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { enabledProfiles, profileNames } from "../src/enforce";
import { loosenedPolicy } from "../src/integrity";
import { initializeRepository, policyInit } from "../src/setup";

// Brownfield profile adoption. An absent `profiles:` runs every profile (execution) but governs none (policy): the
// first explicit list establishes the governed set; after it, dropping a profile or removing the list is loosening.
// Numbers refer to the required cases in the consumer's change request.
const every = profileNames.filter(p => p !== "all");
const drops = (base: string[] | undefined, current: string[] | undefined) =>
  loosenedPolicy(base ? { profiles: base } : {}, current ? { profiles: current } : {}).filter(line => line.startsWith("profiles"));

test("1-5: absent → absent, absent → a first list, and expanding a list are allowed", () => {
  expect(drops(undefined, undefined)).toEqual([]);                          // 1
  expect(drops(undefined, ["docs"])).toEqual([]);                           // 2 first explicit adoption
  expect(drops(undefined, ["docs", "security"])).toEqual([]);               // 3
  expect(drops(["docs"], ["docs"])).toEqual([]);                            // 4
  expect(drops(["docs"], ["docs", "security"])).toEqual([]);                // 5 expansion
});

test("6-8: after adoption, dropping a profile or the list is rejected, so the two-step bypass fails at its first step", () => {
  expect(drops(["docs", "security"], ["docs"])).toEqual(["profiles drops security"]);                                     // 6
  expect(drops(["docs"], undefined)).toEqual(["profiles becomes implicit: the explicit list [docs] was removed"]);        // 7
  // 8: [docs, security] → absent is rejected on its own, and the integrity check judges the merged result against
  // the base branch, so squeezing both steps into one branch is the same comparison as case 6.
  expect(drops(["docs", "security"], undefined)).toEqual(["profiles becomes implicit: the explicit list [docs, security] was removed"]);
  expect(drops(["docs", "security"], ["docs"])).toEqual(["profiles drops security"]);
  // An explicit list naming every profile is still a governed list, not the absent default.
  expect(drops(every, ["docs"])).toEqual([`profiles drops ${every.filter(p => p !== "docs").join(", ")}`]);
});

// A real repository, checked through the CLI the generated CI runs first.
const cli = resolve(import.meta.dir, "../src/cli.ts");
async function run(root: string, ...args: string[]) {
  const child = Bun.spawn({ cmd: [process.execPath, cli, ...args], cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, ATDD_BASE_REF: "base", GITHUB_EVENT_NAME: "" } });
  return { code: await child.exited, out: await new Response(child.stdout).text() + await new Response(child.stderr).text() };
}
const git = async (root: string, ...args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); await child.exited; };
async function brownfield(config: string | null, body: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "atdd-brownfield-"));
  try {
    await git(root, "init", "-q", "-b", "base"); await git(root, "config", "user.email", "b@test"); await git(root, "config", "user.name", "B");
    // An existing repository that installed the package from npm and ran init, as a consumer does.
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "legacy", devDependencies: { "@afokapu/atdd-bun": "^0.7.0" } }, null, 2));
    await writeFile(join(root, "bun.lock"), `{\n  "packages": {\n    "@afokapu/atdd-bun": ["@afokapu/atdd-bun@0.7.0", "", { "bin": { "atdd-bun": "src/cli.ts" } }, "sha512-abc=="],\n  }\n}\n`);
    if (config !== null) await writeFile(join(root, "atdd-bun.yaml"), config);
    expect((await initializeRepository(root)).ok).toBeTrue();
    // Before this release, init wrote no atdd-bun.yaml: a repository initialized then has none unless it wrote one.
    if (config === null) await rm(join(root, "atdd-bun.yaml"));
    await git(root, "add", "-A"); await git(root, "commit", "-qm", "existing repository", "--no-verify");
    await git(root, "checkout", "-qb", "adopt");
    await body(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("9: an absent list still executes every profile", async () => {
  await brownfield("max_staged_files: 20\n", async root => expect(await enabledProfiles(root)).toEqual(every as never));
});

test("10: a repository with no profiles field adopts [docs] through the real integrity CLI, and runs green", async () => {
  await brownfield("max_staged_files: 20\n", async root => {
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 20\nprofiles: [docs]\n");
    const check = await run(root, "integrity");
    expect(check.out).not.toContain("INTEGRITY VIOLATION");
    expect(check.code).toBe(0);
    expect((await run(root, "all")).code).toBe(0);
  });
  // Also when the repository has no atdd-bun.yaml at all.
  await brownfield(null, async root => {
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [docs]\n");
    expect((await run(root, "integrity")).code).toBe(0);
  });
});

test("11: after adoption, the CLI fails on a dropped profile and on a removed list", async () => {
  await brownfield("profiles: [docs, security]\n", async root => {
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [docs]\n");
    let check = await run(root, "integrity");
    expect(check.code).toBe(1);
    expect(check.out).toContain("profiles drops security");
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 20\n");
    check = await run(root, "integrity");
    expect(check.code).toBe(1);
    expect(check.out).toContain("profiles becomes implicit: the explicit list [docs, security] was removed");
  });
});

test("init declares every profile explicitly in a new atdd-bun.yaml, so a greenfield repository is governed from its first commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-greenfield-"));
  try {
    await git(root, "init", "-q", "-b", "main");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "app", devDependencies: { "@afokapu/atdd-bun": "^0.7.0" } }));
    expect((await initializeRepository(root)).ok).toBeTrue();
    const written = Bun.YAML.parse(await readFile(join(root, "atdd-bun.yaml"), "utf8")) as { profiles: string[] };
    expect(written.profiles).toEqual(every);
    expect(drops(written.profiles, ["docs"])).toEqual([`profiles drops ${every.filter(p => p !== "docs").join(", ")}`]);
    // An existing atdd-bun.yaml is never touched.
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 20\n");
    expect((await policyInit(root)).message).toContain("kept");
    expect(await readFile(join(root, "atdd-bun.yaml"), "utf8")).toBe("max_staged_files: 20\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});
