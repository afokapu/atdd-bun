import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { checkInstalledPackage, checkIntegrity, formatIntegrity, loosenedPolicy, writeManifest } from "../src/integrity";
import { hookEvents } from "../src/hooks";
import { initializeRepository } from "../src/setup";

const packageRoot = resolve(import.meta.dir, "..");
const packageVersion = (await Bun.file(join(packageRoot, "package.json")).json() as { version: string }).version;
const git = async (root: string, ...args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); await child.exited; };
const lockEntry = (version = packageVersion) => `    "@afokapu/atdd-bun": ["@afokapu/atdd-bun@${version}", "", { "bin": { "atdd-bun": "src/cli.ts" } }, "sha512-abc=="],\n`;

/** A consumer repository bootstrapped by `init`, installing the package from npm. */
async function consumer(config?: string) {
  const root = await mkdtemp(join(tmpdir(), "atdd-integrity-"));
  await git(root, "init", "-q", "-b", "feature"); await git(root, "config", "user.email", "i@test"); await git(root, "config", "user.name", "I");
  await writeFile(join(root, ".git/info/exclude"), "node_modules/\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "app", devDependencies: { "@afokapu/atdd-bun": `^${packageVersion}` } }, null, 2));
  await writeFile(join(root, "bun.lock"), `{\n  "packages": {\n${lockEntry()}  }\n}\n`);
  if (config !== undefined) await writeFile(join(root, "atdd-bun.yaml"), config);
  await mkdir(join(root, "node_modules/@afokapu"), { recursive: true });
  await symlink(packageRoot, join(root, "node_modules/@afokapu/atdd-bun"), "dir");
  expect((await initializeRepository(root)).ok).toBeTrue();
  return root;
}
const files = (findings: { file: string }[]) => findings.map(f => f.file).sort();
const runCli = async (root: string, ...args: string[]) => {
  const child = Bun.spawn({ cmd: [process.execPath, join(packageRoot, "src/cli.ts"), ...args], cwd: root, stdout: "pipe", stderr: "pipe" });
  return { code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() };
};
const surfacePaths = [
  ...hookEvents.map(event => `.githooks/${event}`),
  ".github/workflows/atdd-bun.yml",
  "atdd-bun.integrity.test.ts",
];
const surfaceIdentity = (text: string) => text.match(/atdd-bun enforcement identity: ([0-9a-f]{64})/)?.[1];
const surfaceContents = async (root: string) => Object.fromEntries(await Promise.all(surfacePaths.map(async path => [path, await readFile(join(root, path), "utf8")] as const)));

test("consumer fixture materializes the project-local CLI that generated hooks execute", async () => {
  const root = await consumer();
  try { expect(await Bun.file(join(root, "node_modules/@afokapu/atdd-bun/src/cli.ts")).exists()).toBeTrue(); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("a freshly bootstrapped consumer is canonical", async () => {
  const root = await consumer();
  try { expect(await checkIntegrity({ root })).toEqual([]); } finally { await rm(root, { recursive: true, force: true }); }
});

test("profile coherence rejects an installed package version that differs from the exact bun.lock resolution", async () => {
  const root = await consumer();
  try {
    const lock = join(root, "bun.lock"), beforeSurfaces = await surfaceContents(root);
    await writeFile(lock, `{\n  "packages": {\n${lockEntry("0.10.99")}  }\n}\n`);
    const beforeLock = await readFile(lock, "utf8"), findings = await checkIntegrity({ root });
    expect(await readFile(lock, "utf8")).toBe(beforeLock);
    expect(await surfaceContents(root)).toEqual(beforeSurfaces);
    expect(findings).toContainEqual(expect.objectContaining({
      file: "node_modules/@afokapu/atdd-bun/package.json",
      detail: expect.stringContaining(`installed version ${packageVersion} does not match exact bun.lock resolution 0.10.99`),
      restore: "bun install --frozen-lockfile",
    }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("profile coherence rejects missing or stale generated hooks without repairing them", async () => {
  const root = await consumer();
  try {
    const stale = join(root, ".githooks/pre-commit"), missing = join(root, ".githooks/pre-push");
    await writeFile(stale, "#!/bin/sh\nexit 0\n");
    await rm(missing);
    const findings = await checkIntegrity({ root });
    expect(await readFile(stale, "utf8")).toBe("#!/bin/sh\nexit 0\n");
    expect(await Bun.file(missing).exists()).toBeFalse();
    expect(findings).toContainEqual(expect.objectContaining({ file: ".githooks/pre-commit", detail: expect.stringContaining("stale"), restore: "bun run atdd-bun init --replace" }));
    expect(findings).toContainEqual(expect.objectContaining({ file: ".githooks/pre-push", detail: expect.stringContaining("missing"), restore: "bun run atdd-bun init --replace" }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("profile coherence rejects missing or stale required generated Provider CI without repairing it", async () => {
  const config = "profiles: [security]\nratchet: { mode: reject-new, profiles: [security] }\n";
  const root = await consumer(config), workflow = join(root, ".github/workflows/atdd-bun.yml");
  try {
    await rm(workflow);
    const missing = await runCli(root, "security", "--root", root);
    expect(await Bun.file(workflow).exists()).toBeFalse();

    const stale = "name: stale-provider-gate\n";
    await writeFile(workflow, stale);
    const outdated = await runCli(root, "security", "--root", root);
    expect(await readFile(workflow, "utf8")).toBe(stale);
    for (const result of [missing, outdated]) {
      expect(result.code).toBe(1);
      expect(result.err).toContain(".github/workflows/atdd-bun.yml");
      expect(result.err).toContain("bun run atdd-bun init --replace");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("supported init refresh regenerates hooks Provider CI and integrity from one exact identity", async () => {
  const root = await consumer("profiles: [security]\nratchet: { mode: reject-new, profiles: [security] }\n");
  try {
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [security, coder]\nratchet: { mode: reject-new, profiles: [security, coder] }\n");
    expect((await initializeRepository(root, true)).ok).toBeTrue();
    const contents = await surfaceContents(root), identities = Object.values(contents).map(surfaceIdentity);
    expect(identities.every(Boolean)).toBeTrue();
    expect([...new Set(identities)]).toHaveLength(1);
    expect(await checkIntegrity({ root })).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("coherent profile validation preserves reject-new with new empty", async () => {
  const root = await consumer("profiles: [security]\nratchet: { mode: reject-new, profiles: [security] }\n");
  try {
    await writeFile(join(root, "readme.md"), "base\n");
    await git(root, "add", "-A"); await git(root, "commit", "-qm", "base", "--no-verify");
    const base = (await Bun.$`git -C ${root} rev-parse HEAD`.text()).trim();
    await writeFile(join(root, "readme.md"), "candidate\n");
    await git(root, "add", "readme.md"); await git(root, "commit", "-qm", "candidate", "--no-verify");
    const result = await runCli(root, "security", "--root", root, "--ratchet", "--base", base);
    expect(result.code, result.err).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({ mode: "reject-new", new: [] });
    const identities = Object.values(await surfaceContents(root)).map(surfaceIdentity);
    expect(identities.every(Boolean)).toBeTrue();
    expect([...new Set(identities)]).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("edited generated files, a non-npm dependency, and a missing test are each reported with the way back", async () => {
  const root = await consumer();
  try {
    const workflow = join(root, ".github/workflows/atdd-bun.yml");
    await writeFile(workflow, (await readFile(workflow, "utf8")).replace("bun run atdd-bun integrity", "true"));
    await writeFile(join(root, "AGENTS.md"), (await readFile(join(root, "AGENTS.md"), "utf8")).replace("Never modify", "Feel free to modify"));
    await writeFile(join(root, "CLAUDE.md"), "# rules\n");
    await rm(join(root, "atdd-bun.integrity.test.ts"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "app", devDependencies: { "@afokapu/atdd-bun": "github:someone/atdd-bun" } }));
    await writeFile(join(root, "bun.lock"), '{\n  "packages": {\n    "@afokapu/atdd-bun": ["@afokapu/atdd-bun@github:someone/atdd-bun#abc", {}, "someone-atdd-bun-abc"],\n  }\n}\n');
    const findings = await checkIntegrity({ root });
    expect(files(findings)).toEqual([".github/workflows/atdd-bun.yml", "AGENTS.md", "CLAUDE.md", "atdd-bun.integrity.test.ts", "bun.lock", "package.json"]);
    const message = formatIntegrity(findings);
    for (const text of ["ATDD INTEGRITY VIOLATION", "You are not allowed to edit them", "stop and ask the human", "restore: bun run atdd-bun ci init --replace", "CI runs this same check on a clean install"]) expect(message).toContain(text);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an upgrade's new version stamp is not tampering, and the test follows bunfig's test root", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-integrity-root-"));
  try {
    await git(root, "init", "-q");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "app", devDependencies: { "@afokapu/atdd-bun": `^${packageVersion}` } }));
    await writeFile(join(root, "bun.lock"), `{\n  "packages": {\n${lockEntry()}  }\n}\n`);
    await writeFile(join(root, "bunfig.toml"), '[install]\nexact = true\n\n[test]\nroot = "tests"\n');
    expect((await initializeRepository(root)).ok).toBeTrue();
    expect(await Bun.file(join(root, "tests/atdd-bun.integrity.test.ts")).exists()).toBeTrue();
    expect(await checkIntegrity({ root })).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("loosening atdd-bun.yaml against the base branch is reported; tightening is not", async () => {
  const root = await consumer();
  try {
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_changed_lines: 300\n");
    // This policy has no reject-new ratchet, so its generated workflow is the strict rendering.
    expect((await (await import("../src/ci")).ciInit(root, true)).ok).toBeTrue();
    await git(root, "add", "-A"); await git(root, "commit", "-qm", "base", "--no-verify"); await git(root, "branch", "base");
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_changed_lines: 200\n");
    expect(await checkIntegrity({ root, base: "base", push: false })).toEqual([]);
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_changed_lines: 5000\nrequire_traceability: false\nprotected_branches: [develop]\n");
    // The workflow's push branches follow protected_branches, so it is reported as stale too.
    const loosened = await checkIntegrity({ root, base: "base", push: false }), finding = loosened.find(f => f.file === "atdd-bun.yaml")!;
    expect(files(loosened)).toEqual([".github/workflows/atdd-bun.yml", "atdd-bun.yaml"]);
    for (const text of ["max_staged_changed_lines 300 → 5000", "require_traceability true → false", "protected_branches drops main, master"]) expect(finding.detail).toContain(text);
    await git(root, "checkout", "-q", "base"); await git(root, "add", "-A"); await git(root, "commit", "-qm", "loosen on main", "--no-verify");
    expect(files(await checkIntegrity({ root, base: "base", push: true }))).toEqual([".github/workflows/atdd-bun.yml", "atdd-bun.yaml"]);
    expect(loosenedPolicy({}, { registry_paths: ["plan/_*.yaml", "src/**"] } as never)).toEqual(["registry_paths adds src/**"]);
    // Excluding `worktrees` from ratchet context digests must not hide its loosening from integrity.
    expect(loosenedPolicy({ worktrees: { enabled: true, require_linked_worktree: true } } as never, { worktrees: { enabled: false, require_linked_worktree: false } } as never)).toEqual(["worktrees.enabled true → false", "worktrees.require_linked_worktree true → false"]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("the installed package is checked file by file against its published manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-integrity-installed-"));
  const installed = join(root, "node_modules/@afokapu/atdd-bun");
  try {
    await mkdir(installed, { recursive: true });
    for (const path of ["package.json", "src", "conventions/coder.bun"]) await cp(join(packageRoot, path), join(installed, path), { recursive: true });
    await writeManifest(installed);
    expect(await checkInstalledPackage(installed)).toEqual([]);
    const rule = join(installed, "conventions/coder.bun/coder.bun.design-token-color.convention.yaml");
    await writeFile(rule, (await readFile(rule, "utf8")).replace("disposition: strict", "disposition: advisory"));
    await rm(join(installed, "src/hooks.ts"));
    await writeFile(join(installed, "src/suppress.ts"), "export {};\n");
    const findings = await checkInstalledPackage(installed);
    expect(findings.map(f => `${f.file.replace("node_modules/@afokapu/atdd-bun/", "")}: ${f.detail}`).sort()).toEqual([
      expect.stringMatching(/^conventions\/coder\.bun\/coder\.bun\.design-token-color\.convention\.yaml: differs from the published/),
      "src/hooks.ts: was deleted from the installed package",
      "src/suppress.ts: was added to the installed package",
    ]);
    expect(findings.every(f => f.restore === "bun install --force")).toBeTrue();
    await rm(join(installed, "integrity.json"));
    expect((await checkInstalledPackage(installed))[0].detail).toContain("was not installed from the npm registry");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the CLI exits non-zero with the loud message, and the generated workflow runs it before enforcement", async () => {
  const root = await consumer();
  try {
    await writeFile(join(root, "AGENTS.md"), "# rules\n");
    const child = Bun.spawn({ cmd: [process.execPath, join(packageRoot, "src/cli.ts"), "integrity"], cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("ATDD INTEGRITY VIOLATION");
    const workflow = await readFile(join(root, ".github/workflows/atdd-bun.yml"), "utf8");
    expect(workflow.indexOf("bun run atdd-bun integrity")).toBeLessThan(workflow.indexOf("bun run atdd-bun all"));
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("R5: the generated workflow runs on pushes to the repository's protected branches, and integrity compares that rendering", async () => {
  const { ciInit } = await import("../src/ci");
  const root = await consumer();
  try {
    const workflow = join(root, ".github/workflows/atdd-bun.yml");
    expect(await readFile(workflow, "utf8")).toContain('branches: ["main", "master"]');
    await writeFile(join(root, "atdd-bun.yaml"), "protected_branches: [develop, main]\n");
    expect(files(await checkIntegrity({ root }))).toEqual([".github/workflows/atdd-bun.yml"]);
    expect((await ciInit(root, true)).ok).toBeTrue();
    expect(await readFile(workflow, "utf8")).toContain('branches: ["develop", "main"]');
    expect(await checkIntegrity({ root })).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("W1: a protected branch name cannot change the generated workflow's structure", async () => {
  const { renderWorkflow } = await import("../src/ci");
  const root = await consumer();
  try {
    const hostile = ["main", "master", "x]\n  push:\n    branches: [never] #", "*", "it's \"quoted\"", "a # comment"];
    await writeFile(join(root, "atdd-bun.yaml"), `protected_branches: ${JSON.stringify(hostile)}\n`);
    const parsed = Bun.YAML.parse((await renderWorkflow(root)).replace(/\$\{\{[^}]*\}\}/g, "x")) as { on: { push: { branches: string[] } } };
    expect(parsed.on.push.branches).toEqual(hostile);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an unreadable atdd-bun.yaml: integrity reports it as a finding, and ci init refuses rather than guess the branches", async () => {
  const { ciInit } = await import("../src/ci");
  const root = await consumer();
  try {
    await writeFile(join(root, "atdd-bun.yaml"), "protected_branches: [trunk]\n");
    expect((await ciInit(root, true)).ok).toBeTrue();
    const workflow = join(root, ".github/workflows/atdd-bun.yml"), before = await readFile(workflow, "utf8");
    await writeFile(join(root, "atdd-bun.yaml"), "protected_branches: [unclosed\n");
    // GLM round 9 (Z2): the restore command must not rewrite the push branches to a guess.
    const refused = await ciInit(root, true);
    expect(refused.ok).toBeFalse();
    expect(refused.message).toContain("could not be parsed");
    expect(await readFile(workflow, "utf8")).toBe(before);
    // GLM round 9 (Z1): a finding with a restore, not a crash; the other findings are kept.
    await writeFile(join(root, "AGENTS.md"), "# edited\n");
    const findings = await checkIntegrity({ root, base: "HEAD", push: false });
    expect(files(findings)).toEqual(["AGENTS.md", "atdd-bun.yaml"]);
    expect(findings.find(f => f.file === "atdd-bun.yaml")!.restore).toBe("fix the YAML syntax in atdd-bun.yaml, then re-run the check");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a baseline atdd-bun.yaml that does not parse is a finding, not a crash, and is never read as the defaults", async () => {
  const root = await consumer();
  try {
    await writeFile(join(root, "atdd-bun.yaml"), "protected_branches: [unclosed\n");
    await git(root, "add", "-A"); await git(root, "commit", "-qm", "broken base", "--no-verify"); await git(root, "branch", "base");
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 20\n");
    const findings = (await checkIntegrity({ root, base: "base", push: false })).filter(f => f.file === "atdd-bun.yaml");
    expect(findings.map(f => f.detail)).toEqual([expect.stringContaining("could not be parsed")]);
    expect(findings[0].restore).toStartWith("repair the atdd-bun.yaml on the base branch");
    expect(findings[0].restore).toContain("bring that repair into this branch");
    // The recovery the restore describes: repair the base branch, then merge it into the branch under review.
    await git(root, "stash", "-q", "-u"); await git(root, "checkout", "-qb", "work", "base"); await git(root, "stash", "pop", "-q");
    await git(root, "commit", "-qam", "work", "--no-verify");
    await git(root, "checkout", "-q", "base"); await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 20\n"); await git(root, "commit", "-qam", "repair base", "--no-verify");
    await git(root, "checkout", "-q", "work");
    expect((await checkIntegrity({ root, base: "base", push: false })).filter(f => f.file === "atdd-bun.yaml").map(f => f.detail)).toEqual([expect.stringContaining("could not be parsed")]);   // still on the broken merge base
    await git(root, "merge", "-q", "--no-edit", "base", "-X", "theirs");
    expect((await checkIntegrity({ root, base: "base", push: false })).filter(f => f.file === "atdd-bun.yaml")).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a baseline that parses to a scalar or a list is not a policy and is never read as the defaults; a push gets its own restore", async () => {
  for (const baseline of ["42\n", "[a, b]\n", "true\n"]) {
    const root = await consumer();
    try {
      await writeFile(join(root, "atdd-bun.yaml"), baseline);
      await git(root, "add", "-A"); await git(root, "commit", "-qm", "odd base", "--no-verify"); await git(root, "branch", "base");
      await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 20\n");
      const [finding] = (await checkIntegrity({ root, base: "base", push: false })).filter(f => f.file === "atdd-bun.yaml");
      expect(finding.detail, baseline).toContain("is not a policy mapping");
      // On a push the comparison is with the replaced tip, not a merge base, so the restore says what clears it there.
      await git(root, "commit", "-qam", "repair", "--no-verify");
      const [pushed] = (await checkIntegrity({ root, base: "base", push: true })).filter(f => f.file === "atdd-bun.yaml");
      expect(pushed.restore, baseline).toStartWith("this push is compared with the tip it replaced");
    } finally { await rm(root, { recursive: true, force: true }); }
  }
}, 30_000);

test("a wrongly typed policy field is a finding on either side, never a crash; an empty or null policy is the defaults", async () => {
  const cases: Array<[string, string, string]> = [
    ["protected_branches: 42\n", "max_staged_files: 20\n", "the baseline"],
    ["max_staged_files: 20\n", "registry_paths: plan\n", "which the hooks would ignore or misread"],
    ["max_staged_files: 20\n", "worktrees: [on]\n", "worktrees must be a mapping"],
    ["max_staged_files: 20\n", "worktrees: { primary_branch: [main] }\n", "worktrees.primary_branch must be a string"],
  ];
  for (const [baseline, current, expected] of cases) {
    const root = await consumer();
    try {
      await writeFile(join(root, "atdd-bun.yaml"), baseline);
      await git(root, "add", "-A"); await git(root, "commit", "-qm", "base", "--no-verify"); await git(root, "branch", "base");
      await writeFile(join(root, "atdd-bun.yaml"), current);
      const findings = (await checkIntegrity({ root, base: "base", push: false })).filter(f => f.file === "atdd-bun.yaml").map(f => f.detail);
      expect(findings, `${baseline} → ${current}`).toEqual([expect.stringContaining(expected)]);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  // Declined (GLM Q1 on #22): a null or comment-only baseline is the default policy, so comparing against the defaults is right.
  const root = await consumer();
  try {
    await writeFile(join(root, "atdd-bun.yaml"), "# nothing configured\n");
    await git(root, "add", "-A"); await git(root, "commit", "-qm", "base", "--no-verify"); await git(root, "branch", "base");
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 10\n");
    expect((await checkIntegrity({ root, base: "base", push: false })).filter(f => f.file === "atdd-bun.yaml")).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("a key with no value is absent, as the hooks read it: a null baseline field does not lock the repository", async () => {
  const root = await consumer();
  try {
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [docs]\nworktrees:\n  # enabled: false\nprotected_branches:\n");
    await git(root, "add", "-A"); await git(root, "commit", "-qm", "base", "--no-verify"); await git(root, "branch", "base");
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [docs]\nworktrees: { enabled: true }\n");
    expect((await checkIntegrity({ root, base: "base", push: false })).filter(f => f.file === "atdd-bun.yaml")).toEqual([]);
    // And a null in the working tree compares as the default, not as 0.
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [docs]\nmax_staged_files:\n");
    expect((await checkIntegrity({ root, base: "base", push: false })).filter(f => f.file === "atdd-bun.yaml")).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
