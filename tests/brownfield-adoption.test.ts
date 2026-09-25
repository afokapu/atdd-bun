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
    // Every profile but the opt-in delivery profile, which gates every change on a reviewed tranche record.
    const governed = every.filter(p => p !== "delivery");
    expect(written.profiles).toEqual(governed);
    expect(drops(written.profiles, ["docs"])).toEqual([`profiles drops ${governed.filter(p => p !== "docs").join(", ")}`]);
    // An existing atdd-bun.yaml is never touched.
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 20\n");
    expect((await policyInit(root)).message).toContain("kept");
    expect(await readFile(join(root, "atdd-bun.yaml"), "utf8")).toBe("max_staged_files: 20\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("8, pushed: a multi-commit direct push [docs, security] → no list → [docs] is judged from the pre-push tip", async () => {
  const { checkIntegrity } = await import("../src/integrity");
  await brownfield("profiles: [docs, security]\n", async root => {
    await git(root, "checkout", "-q", "base"); const before = (await Bun.$`git -C ${root} rev-parse HEAD`.text()).trim();
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 20\n"); await git(root, "commit", "-qam", "drop the list", "--no-verify");
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [docs]\n"); await git(root, "commit", "-qam", "narrow", "--no-verify");
    const policy = (findings: { file: string; detail: string }[]) => findings.filter(f => f.file === "atdd-bun.yaml").map(f => f.detail);
    // Judged one commit deep, the push reads as a first adoption; judged from the pre-push tip, it drops security.
    // (ATDD_BASE_REF is scrubbed so the one-commit-deep view is what this assertion sees, even inside a CI push run.)
    const saved = process.env.ATDD_BASE_REF; delete process.env.ATDD_BASE_REF;
    try { expect(policy(await checkIntegrity({ root, base: "", push: true }))).toEqual([]); } finally { if (saved !== undefined) process.env.ATDD_BASE_REF = saved; }
    expect(policy(await checkIntegrity({ root, base: before, push: true }))).toEqual([expect.stringContaining("profiles drops security")]);
    // A new branch (all-zero before-SHA) has no previous tip: judged against its parent, as before.
    expect(policy(await checkIntegrity({ root, base: "0000000000000000000000000000000000000000", push: true }))).toEqual([]);
    // A before-SHA that cannot be resolved fails closed rather than skipping the check.
    const [unresolved] = (await checkIntegrity({ root, base: "1234567890abcdef1234567890abcdef12345678", push: true })).filter(f => f.file === "atdd-bun.yaml");
    expect(unresolved.detail).toContain("cannot resolve the policy baseline 1234567890abcdef1234567890abcdef12345678");
    // The way back names the full SHA: after a force push the replaced tip is on no branch, so `git fetch origin` alone misses it.
    expect(unresolved.restore).toStartWith("git fetch origin 1234567890abcdef1234567890abcdef12345678, then re-run the check");
  });
});

test("8, force-pushed: a rewritten history is judged against the tip it replaced, not a merge base", async () => {
  const { checkIntegrity } = await import("../src/integrity");
  // P (no list) → A ([docs, security]) is the pushed tip; a force push replaces it with P → B (no list) → C ([docs]).
  await brownfield("max_staged_files: 20\n", async root => {
    await git(root, "checkout", "-q", "base"); const p = (await Bun.$`git -C ${root} rev-parse HEAD`.text()).trim();
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [docs, security]\n"); await git(root, "commit", "-qam", "A", "--no-verify");
    const a = (await Bun.$`git -C ${root} rev-parse HEAD`.text()).trim();
    await git(root, "reset", "-q", "--hard", p);
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 30\n"); await git(root, "commit", "-qam", "B", "--no-verify");
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [docs]\n"); await git(root, "commit", "-qam", "C", "--no-verify");
    const findings = (await checkIntegrity({ root, base: a, push: true })).filter(f => f.file === "atdd-bun.yaml").map(f => f.detail);
    expect(findings).toEqual([expect.stringContaining("profiles drops security")]);
  });
});

test("the merge queue is judged against its target, not the default branch; an unresolvable baseline fails closed", async () => {
  const { checkIntegrity } = await import("../src/integrity");
  const workflow = await readFile(resolve(import.meta.dir, "../templates/github/atdd-bun.yml"), "utf8");
  expect(workflow).toContain("github.event_name == 'merge_group' && github.event.merge_group.base_sha");
  // Set at job level, so the integrity step and the generated integrity test judge the same baseline.
  expect(workflow.indexOf("ATDD_BASE_REF")).toBeLessThan(workflow.indexOf("steps:"));
  // The queue's target already governs [docs, security]; the queued result narrows it to [docs].
  await brownfield("profiles: [docs, security]\n", async root => {
    const target = (await Bun.$`git -C ${root} rev-parse base`.text()).trim();
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [docs]\n"); await git(root, "commit", "-qam", "queued", "--no-verify");
    const policy = async (base: string) => (await checkIntegrity({ root, base, push: false })).filter(f => f.file === "atdd-bun.yaml").map(f => f.detail);
    expect(await policy(target)).toEqual([expect.stringContaining("profiles drops security")]);
    expect(await policy("1234567890abcdef1234567890abcdef12345678")).toEqual([expect.stringContaining("cannot resolve the policy baseline")]);
  });
});

test("the restore hint for an unresolvable baseline can always recover it", async () => {
  const { baselineRestore } = await import("../src/integrity");
  const sha1 = "1234567890abcdef1234567890abcdef12345678", sha256 = "ab".repeat(32);
  for (const full of [sha1, sha1.toUpperCase(), sha256]) expect(baselineRestore(full), full).toStartWith(`git fetch origin ${full}, then`);
  expect(baselineRestore("1234567")).toStartWith("if 1234567 is an abbreviated SHA, set ATDD_BASE_REF to its full SHA");
  expect(baselineRestore("cafe")).toContain("if it is a branch or tag, git fetch origin");
  expect(baselineRestore("a".repeat(50))).toBe("git fetch origin, then re-run the check");   // no object id is 41-63 hex long
  expect(baselineRestore("origin/release")).toBe("git fetch origin, then re-run the check");
});
