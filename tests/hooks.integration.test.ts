import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as enforcer from "../src/enforce";
import { concreteProfiles } from "../src/enforce";
import { finishWorktree, hookEvents, hooksStatus, installHooks, policy, runHook, startWorktree, uninstallHooks, worktreeStatus } from "../src/hooks";
import { activationContextDigest, contextDigest } from "../src/ratchet";

const git = async (root: string, args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); return { code: await child.exited, out: (await new Response(child.stdout).text()), err: (await new Response(child.stderr).text()) }; };
async function repo(branch = "feature") { const root = await mkdtemp(join(tmpdir(), "atdd-bun-hooks-")); for (const args of [["init", "-q", "-b", branch], ["config", "user.email", "hook@test"], ["config", "user.name", "Hook"]]) await git(root, args); await writeFile(join(root, "readme.md"), "init\n"); await git(root, ["add", "."]); await git(root, ["commit", "-qm", "init"]); await writeFile(join(root, ".git", "info", "exclude"), "node_modules/\n"); await mkdir(join(root, "node_modules", "@afokapu"), { recursive: true }); await symlink(resolve(import.meta.dir, ".."), join(root, "node_modules", "@afokapu", "atdd-bun"), "dir"); return root; }
const cleanup = (root: string) => rm(root, { recursive: true, force: true });

async function worktreeLayout(policyInFirstCommit = true) {
  const container = await mkdtemp(join(tmpdir(), "atdd-bun-layout-")), main = join(container, "repository");
  await mkdir(main); for (const args of [["init", "-q", "-b", "main"], ["config", "user.email", "worktree@test"], ["config", "user.name", "Worktree"]]) await git(main, args);
  if (policyInFirstCommit) await writeFile(join(main, "atdd-bun.yaml"), "worktrees:\n  enabled: true\n");
  await writeFile(join(main, "readme.md"), "init\n"); await git(main, ["add", "."]); await git(main, ["commit", "-qm", "init"]);
  return { container, main, worktrees: join(container, "worktrees", "repository") };
}

test("real Git installation is idempotent, worktree-local, and removable", async () => {
  const root = await repo(); try { expect((await installHooks(root)).ok).toBeTrue(); expect((await installHooks(root)).ok).toBeTrue(); expect((await hooksStatus(root)).ok).toBeTrue(); expect((await git(root, ["config", "--worktree", "--get", "core.hooksPath"])).out.trim()).toBe(".githooks"); for (const event of hookEvents) expect((await readFile(join(root, ".githooks", event), "utf8")).includes("atdd ")).toBeFalse(); const wt = `${root}-wt`; expect((await git(root, ["worktree", "add", "-q", "-b", "linked", wt])).code).toBe(0); expect((await installHooks(wt)).ok).toBeTrue(); expect((await git(wt, ["config", "--worktree", "--get", "core.hooksPath"])).out.trim()).toBe(".githooks"); expect((await uninstallHooks(root)).ok).toBeTrue(); expect((await hooksStatus(root)).ok).toBeFalse(); }
  finally { await cleanup(root); await cleanup(`${root}-wt`); }
}, 20_000);

test("profile coherence rejects tracked generated hooks without a real worktree-local hooksPath binding", async () => {
  const root = await repo(); try {
    const packageVersion = (await Bun.file(resolve(import.meta.dir, "../package.json")).json() as { version: string }).version;
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "consumer", devDependencies: { "@afokapu/atdd-bun": `^${packageVersion}` } }));
    await writeFile(join(root, "bun.lock"), `{\n  "packages": {\n    "@afokapu/atdd-bun": ["@afokapu/atdd-bun@${packageVersion}", "", { "bin": { "atdd-bun": "src/cli.ts" } }, "sha512-abc=="]\n  }\n}\n`);
    await installHooks(root);
    const beforeHooks = await Promise.all(hookEvents.map(event => readFile(join(root, ".githooks", event), "utf8")));
    await git(root, ["config", "--worktree", "--unset", "core.hooksPath"]);
    const beforeStatus = (await git(root, ["status", "--porcelain"])).out;
    const status = await hooksStatus(root);
    expect(status.ok).toBeFalse();
    expect((await git(root, ["config", "--worktree", "--get", "core.hooksPath"])).out.trim()).toBe("");
    expect(await Promise.all(hookEvents.map(event => readFile(join(root, ".githooks", event), "utf8")))).toEqual(beforeHooks);
    expect((await git(root, ["status", "--porcelain"])).out).toBe(beforeStatus);
    expect(status.message).toContain("core.hooksPath");
    expect(status.message).toContain("bun run atdd-bun init --replace");
  } finally { await cleanup(root); }
});

test("stale generated dispatcher directs an approved upgrade through install and full surface refresh before hook logic", async () => {
  const root = await repo(); try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "consumer", devDependencies: { "@afokapu/atdd-bun": "^0.9.9" } }));
    await writeFile(join(root, "bun.lock"), `{\n  "packages": {\n    "@afokapu/atdd-bun": ["@afokapu/atdd-bun@0.9.9", "", { "bin": { "atdd-bun": "src/cli.ts" } }, "sha512-old=="]\n  }\n}\n`);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [security]\nprotected_branches: [feature]\n");
    expect((await installHooks(root)).ok).toBeTrue();
    const child = Bun.spawn({ cmd: [join(root, ".githooks/pre-commit")], cwd: root, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("installed package 0.10.0 does not match exact bun.lock resolution 0.9.9");
    expect(stderr).toContain("bun install --frozen-lockfile");
    expect(stderr).toContain("bun run atdd-bun init --replace");
    expect(stderr).not.toContain("protected branch feature is blocked");
  } finally { await cleanup(root); }
});

test("spoof-named consumer cannot use source hook fallback or skip exact lock and install checks", async () => {
  const root = await repo(); try {
    await rm(join(root, "node_modules"), { recursive: true, force: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "@afokapu/atdd-bun", version: "9.9.9" }));
    await mkdir(join(root, "src"), { recursive: true });
    const marker = join(root, "spoof-cli-ran");
    await writeFile(join(root, "src/cli.ts"), `await Bun.write(${JSON.stringify(marker)}, "consumer source fallback executed\\n");\n`);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [security]\n");
    expect((await installHooks(root)).ok).toBeTrue();

    const hook = Bun.spawn({ cmd: [join(root, ".githooks/pre-commit")], cwd: root, stdout: "pipe", stderr: "pipe" });
    const [hookCode, hookError] = await Promise.all([hook.exited, new Response(hook.stderr).text()]);
    expect(hookCode).toBe(1);
    expect(hookError).toContain("worktree-local @afokapu/atdd-bun is missing");
    expect(hookError).toContain("bun install --frozen-lockfile && bun run atdd-bun init --replace");
    expect(await Bun.file(marker).exists()).toBeFalse();

    const cli = Bun.spawn({ cmd: [process.execPath, resolve(import.meta.dir, "../src/cli.ts"), "security", "--root", root], cwd: root, stdout: "pipe", stderr: "pipe" });
    const [cliCode, cliError] = await Promise.all([cli.exited, new Response(cli.stderr).text()]);
    expect(cliCode).toBe(1);
    expect(cliError).toContain("@afokapu/atdd-bun is not a dependency");
    expect(cliError).toContain("bun add -d @afokapu/atdd-bun@<operator-approved-version> --exact");
  } finally { await cleanup(root); }
});

test("generated hook dispatchers do not bind this toolkit checkout's absolute CLI path", async () => {
  const root = await repo(); try {
    await installHooks(root);
    const dispatcher = await readFile(join(root, ".githooks", "pre-commit"), "utf8");
    expect(dispatcher).not.toContain(resolve(import.meta.dir, "../src/cli.ts"));
  } finally { await cleanup(root); }
});

test("a consumer src/cli.ts cannot impersonate a missing project-local atdd-bun hook CLI", async () => {
  const root = await repo("main"); try {
    await rm(join(root, "node_modules"), { recursive: true, force: true });
    await installHooks(root);
    await mkdir(join(root, "src"), { recursive: true }); await writeFile(join(root, "src", "cli.ts"), "process.exit(0);\n");
    await writeFile(join(root, "readme.md"), "changed\n"); await git(root, ["add", "."]);
    expect((await git(root, ["commit", "-m", "must-not-bypass"])).code).not.toBe(0);
  } finally { await cleanup(root); }
}, 20_000);

test("real Git policy rejects protected branches, each micro threshold, deletion without token, and bad traceability", async () => {
  const root = await repo("main"); try {
    await installHooks(root); await writeFile(join(root, "x.ts"), "export const x = 1;\n"); await git(root, ["add", "x.ts"]); expect((await git(root, ["commit", "-m", "blocked"])).code).not.toBe(0);
    await git(root, ["checkout", "-qb", "feature"]); await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 0\nmax_staged_changed_lines: 0\n"); await git(root, ["add", "atdd-bun.yaml"]); expect((await runHook("pre-commit", root)).ok).toBeFalse();
    await writeFile(join(root, "plan.yml"), "x\n"); await git(root, ["add", "plan.yml"]); const trace = await runHook("pre-commit", root); expect(trace.ok).toBeFalse();
    for (let i = 0; i < 51; i++) await writeFile(join(root, `delete-${i}.txt`), "x\n"); await git(root, ["add", "."]); await git(root, ["commit", "-qm", "seed deletes", "--no-verify"]); for (let i = 0; i < 51; i++) await rm(join(root, `delete-${i}.txt`)); await git(root, ["add", "-A"]); const message = join(root, "message"); await writeFile(message, "delete\n"); expect((await runHook("commit-msg", root, [message])).ok).toBeFalse(); await writeFile(message, "delete\n[mass-delete-approved]\n"); expect((await runHook("commit-msg", root, [message])).ok).toBeTrue();
  } finally { await cleanup(root); }
}, 30_000);

test("profile activation commit gate compares HEAD with the staged candidate and carries existing findings", async () => {
  const root = await repo(); try {
    await installHooks(root);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow]\n");
    await mkdir(join(root, "plan"));
    await writeFile(join(root, "plan", "orders.yaml"), "urn: wmbt:orders:E001\nacceptances:\n  - identity: { urn: acc:orders:E001-UNIT-001 }\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "base with traceability debt", "--no-verify"]);
    const base = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow, traceability]\nratchet: { mode: reject-new, profiles: [flow, traceability] }\n");
    await git(root, ["add", "atdd-bun.yaml"]);
    const result = await runHook("pre-commit", root);
    expect(result.ok, result.message).toBeTrue();
    expect(JSON.parse(result.message)).toMatchObject({ mode: "reject-new", base, profiles: ["flow", "traceability"], carried: [expect.any(String)], new: [], resolved: [] });
    const committed = await git(root, ["commit", "-qm", "activate profiles"]);
    expect(committed.code, `${committed.out}\n${committed.err}`).toBe(0);
    expect((await git(root, ["rev-parse", "HEAD"])).out.trim()).not.toBe(base);
  } finally { await cleanup(root); }
}, 30_000);

test("reject-new commit gate accepts an unchanged active profile set and carries existing findings", async () => {
  const root = await repo(); try {
    await installHooks(root);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow, traceability]\nratchet: { mode: reject-new, profiles: [flow, traceability] }\n");
    await mkdir(join(root, "plan"));
    await writeFile(join(root, "plan", "orders.yaml"), "urn: wmbt:orders:E001\nacceptances:\n  - identity: { urn: acc:orders:E001-UNIT-001 }\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "active ratchet with traceability debt", "--no-verify"]);
    const base = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    // A staged dependency/regeneration-style candidate leaves policy and its active profiles unchanged.
    await writeFile(join(root, "package.json"), "{\"name\": \"consumer\"}\n");
    await git(root, ["add", "package.json"]);
    const result = await runHook("pre-commit", root);
    expect(result.ok, result.message).toBeTrue();
    expect(JSON.parse(result.message)).toMatchObject({ mode: "reject-new", base, profiles: ["flow", "traceability"], carried: [expect.any(String)], new: [], resolved: [] });
  } finally { await cleanup(root); }
}, 30_000);

test("reject-new commit gate refuses unchanged-profile context drift", async () => {
  const root = await repo(); try {
    await installHooks(root);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow]\nratchet: { mode: reject-new, profiles: [flow] }\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "active ratchet", "--no-verify"]);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow]\nratchet: { mode: reject-new, profiles: [flow] }\ntopology: { plan_root: contracts }\n");
    await git(root, ["add", "atdd-bun.yaml"]);
    const result = await runHook("pre-commit", root);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("unchanged explicit profiles/context") });
  } finally { await cleanup(root); }
}, 30_000);

test("profile activation commit gate refuses an incomplete dirty candidate", async () => {
  const root = await repo(); try {
    await installHooks(root);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow]\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "base", "--no-verify"]);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow, traceability]\nratchet: { mode: reject-new, profiles: [flow, traceability] }\n");
    await git(root, ["add", "atdd-bun.yaml"]);
    await writeFile(join(root, "untracked.txt"), "must not become an invisible activation candidate\n");
    const result = await runHook("pre-commit", root);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("no unstaged or untracked") });
  } finally { await cleanup(root); }
}, 30_000);

test("profile activation commit gate rejects new staged findings", async () => {
  const root = await repo(); try {
    await installHooks(root);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow]\n");
    await mkdir(join(root, "plan"));
    await writeFile(join(root, "plan", "orders.yaml"), "urn: wmbt:orders:E001\nacceptances:\n  - identity: { urn: acc:orders:E001-UNIT-001 }\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "base with traceability debt", "--no-verify"]);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow, traceability]\nratchet: { mode: reject-new, profiles: [flow, traceability] }\n");
    await writeFile(join(root, "plan", "payments.yaml"), "urn: wmbt:payments:E001\nacceptances:\n  - identity: { urn: acc:payments:E001-UNIT-001 }\n");
    await git(root, ["add", "."]);
    const result = await runHook("pre-commit", root);
    expect(result.ok, result.message).toBeFalse();
    expect(JSON.parse(result.message)).toMatchObject({ mode: "reject-new", new: [expect.any(String)] });
  } finally { await cleanup(root); }
}, 30_000);

test("pre-commit uses the canonical planner schema gate for staged plan artifacts", async () => {
  const root = await repo(); try {
    await installHooks(root);
    await mkdir(join(root, "plan/_trains"), { recursive: true });
    await writeFile(join(root, "plan/_trains/orders.yaml"), "train_id: 1001-checkout\ntitle: Checkout journey\ndescription: A deliberately invalid train identity.\nthemes: [orders]\nparticipants: [wagon:orders]\nsequence:\n  - step: 1\n    intent: Place the order\n    from: wagon:orders\n    to: wagon:orders\n    artifact: orders:placed\n");
    await git(root, ["add", "plan/_trains/orders.yaml"]);
    const result = await runHook("pre-commit", root);
    expect(result.ok).toBeFalse();
    expect(result.message).toContain("planner.train.naming");
  } finally { await cleanup(root); }
}, 20_000);

test("declarative registries are exempt from the micro-commit size caps but still validated and removal-approved", async () => {
  const root = await repo(); try {
    const registry = (entries: number) => ["contracts:", ...Array.from({ length: entries }, (_, i) => `  - id: bad${i}\n    path: nope\n    theme: t\n    producers: []`)].join("\n") + "\n";
    await mkdir(join(root, "contracts"), { recursive: true });
    await writeFile(join(root, "contracts/_contracts.yaml"), registry(150)); await git(root, ["add", "contracts/_contracts.yaml"]);
    const large = await runHook("pre-commit", root);
    expect(large.ok).toBeFalse(); expect(large.message).not.toContain("exceed"); expect(large.message).toContain("planner.contract.registry-coherence");
    await writeFile(join(root, "atdd-bun.yaml"), "require_traceability: false\n"); await git(root, ["add", "atdd-bun.yaml"]);
    expect((await runHook("pre-commit", root)).message).toContain("planner.contract.registry-coherence");
    await writeFile(join(root, "big.ts"), Array.from({ length: 400 }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n"); await git(root, ["add", "big.ts"]);
    // 400 code lines + 1 atdd-bun.yaml line; the 601 staged registry lines are not counted.
    expect((await runHook("pre-commit", root)).message).toContain("staged changed lines 401 exceed 350");
    await git(root, ["commit", "-qm", "seed registry", "--no-verify"]);
    const message = join(root, "message"); await writeFile(message, "rewrite\n");
    await writeFile(join(root, "contracts/_contracts.yaml"), registry(150).replaceAll("path: nope", "path: nope2")); await git(root, ["add", "-A"]);
    expect((await runHook("commit-msg", root, [message])).ok).toBeTrue();
    await git(root, ["reset", "-q", "--hard"]); await rm(join(root, "contracts/_contracts.yaml")); await git(root, ["add", "-A"]);
    const removal = await runHook("commit-msg", root, [message]);
    expect(removal.ok).toBeFalse(); expect(removal.message).toContain("registry removal of 601 net lines");
    await writeFile(message, "remove registry\n[mass-delete-approved]\n"); expect((await runHook("commit-msg", root, [message])).ok).toBeTrue();
  } finally { await cleanup(root); }
}, 30_000);

test("a commit is never refused for the work still left uncommitted: committing is how that work shrinks", async () => {
  const root = await repo(); try {
    // A leftover max_uncommitted_files from an older config is ignored.
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_files: 100\nmax_uncommitted_files: 1\nrequire_traceability: false\n");
    for (let i = 0; i < 15; i++) await writeFile(join(root, `part-${i}.md`), "x\n");
    await git(root, ["add", "-A"]); await git(root, ["commit", "-qm", "seed", "--no-verify"]);
    for (let i = 0; i < 11; i++) await writeFile(join(root, `untracked-${i}.md`), "x\n");
    for (let i = 0; i < 11; i++) await writeFile(join(root, `part-${i}.md`), "changed\n");
    await git(root, ["add", "part-0.md", "part-1.md", "part-2.md", "part-3.md"]);
    const small = await runHook("pre-commit", root);
    expect(small.message).not.toContain("uncommitted");
    expect(small.ok).toBeTrue();
  } finally { await cleanup(root); }
}, 20_000);

test("pre-push reject-new compares the exact remote range and accepts carried-only findings", async () => {
  const root = await repo(); try {
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow, traceability]\nratchet: { mode: reject-new, profiles: [flow, traceability] }\n");
    await mkdir(join(root, "plan"));
    await writeFile(join(root, "plan", "orders.yaml"), "urn: wmbt:orders:E001\nacceptances:\n  - identity: { urn: acc:orders:E001-UNIT-001 }\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "base with carried traceability finding", "--no-verify"]);
    const base = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    await writeFile(join(root, "readme.md"), "safe candidate change\n");
    await git(root, ["add", "readme.md"]); await git(root, ["commit", "-qm", "safe candidate", "--no-verify"]);
    const candidate = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    // The checkout moves on with a bad commit; only the advertised ref is valid for this push.
    await writeFile(join(root, "plan", "unadvertised.yaml"), "urn: wmbt:unadvertised:E001\nacceptances:\n  - identity: { urn: acc:unadvertised:E001-UNIT-001 }\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "unadvertised finding", "--no-verify"]);
    const result = await runHook("pre-push", root, [], `refs/heads/feature ${candidate} refs/heads/feature ${base}\n`);
    expect(result.ok, result.message).toBeTrue();
    expect(JSON.parse(result.message)).toMatchObject({ mode: "reject-new", base, candidate, profiles: ["flow", "traceability"], carried: [expect.any(String)], new: [], resolved: [] });
  } finally { await cleanup(root); }
}, 30_000);

test("pre-push chooses the ratchet from the pushed remote ref, not the local ref", async () => {
  const root = await repo(); try {
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow, traceability]\nratchet: { mode: reject-new, profiles: [flow, traceability] }\n");
    await mkdir(join(root, "plan"));
    await writeFile(join(root, "plan", "orders.yaml"), "urn: wmbt:orders:E001\nacceptances:\n  - identity: { urn: acc:orders:E001-UNIT-001 }\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "base with carried traceability finding", "--no-verify"]);
    const base = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    // Touching the file that carries the debt makes the strict gate see the carried finding.
    await writeFile(join(root, "plan", "orders.yaml"), "# touched\nurn: wmbt:orders:E001\nacceptances:\n  - identity: { urn: acc:orders:E001-UNIT-001 }\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "safe candidate", "--no-verify"]);
    const candidate = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    for (const localRef of ["HEAD", candidate]) {
      const accepted = await runHook("pre-push", root, [], `${localRef} ${candidate} refs/heads/x ${base}\n`);
      expect(accepted.ok, accepted.message).toBeTrue();
      expect(JSON.parse(accepted.message)).toMatchObject({ mode: "reject-new", base, candidate, carried: [expect.any(String)], new: [] });
    }
    await writeFile(join(root, "plan", "added.yaml"), "urn: wmbt:added:E001\nacceptances:\n  - identity: { urn: acc:added:E001-UNIT-001 }\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "new finding", "--no-verify"]);
    const withNew = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    for (const localRef of ["HEAD", withNew]) {
      const refused = await runHook("pre-push", root, [], `${localRef} ${withNew} refs/heads/x ${base}\n`);
      expect(refused.ok, refused.message).toBeFalse(); expect(refused.message).toContain("new");
    }
    // Non-branch remote refs stay strict even when the local ref is a branch.
    for (const localRef of ["HEAD", "refs/heads/feature"]) {
      const tag = await runHook("pre-push", root, [], `${localRef} ${candidate} refs/tags/v1 ${base}\n`);
      expect(tag.ok, tag.message).toBeFalse();
    }
  } finally { await cleanup(root); }
}, 30_000);

test("pre-push does not let a carried-only ratchet ref mask an ordinary failing ref", async () => {
  const root = await repo(); try {
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow, traceability]\nratchet: { mode: reject-new, profiles: [flow, traceability] }\n");
    await mkdir(join(root, "plan"));
    await writeFile(join(root, "plan", "orders.yaml"), "urn: wmbt:orders:E001\nacceptances:\n  - identity: { urn: acc:orders:E001-UNIT-001 }\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "ratchet base with debt", "--no-verify"]);
    const base = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    await writeFile(join(root, "readme.md"), "safe ratchet candidate\n"); await git(root, ["add", "readme.md"]); await git(root, ["commit", "-qm", "safe ratchet candidate", "--no-verify"]);
    const ratchetCandidate = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    await git(root, ["checkout", "-qb", "ordinary", base]);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [unknown]\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "ordinary strict candidate", "--no-verify"]);
    const ordinaryCandidate = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    const ordinary = await runHook("pre-push", root, [], `refs/heads/ordinary ${ordinaryCandidate} refs/heads/ordinary ${base}\n`);
    expect(ordinary.ok, ordinary.message).toBeFalse(); expect(ordinary.message).toContain("Bun enforcer resolution failed");
    const result = await runHook("pre-push", root, [], `refs/heads/ratchet ${ratchetCandidate} refs/heads/ratchet ${base}\nrefs/heads/ordinary ${ordinaryCandidate} refs/heads/ordinary ${base}\n`);
    expect(result.ok, result.message).toBeFalse(); expect(result.message).toContain("Bun enforcer resolution failed");
    const tag = await runHook("pre-push", root, [], `refs/tags/v1 ${ordinaryCandidate} refs/tags/v1 ${base}\n`);
    expect(tag.ok, tag.message).toBeFalse(); expect(tag.message).toContain("Bun enforcer resolution failed");
    const zero = "0".repeat(40);
    expect((await runHook("pre-push", root, [], `refs/heads/ordinary ${zero} refs/heads/ordinary ${ordinaryCandidate}\n`)).ok).toBeTrue();
    expect((await runHook("pre-push", root, [], `refs/heads/ordinary ${zero} refs/heads/ordinary ${"f".repeat(40)}\n`)).ok).toBeFalse();
    expect((await runHook("pre-push", root, [], `refs/heads/main ${zero} refs/heads/main ${ordinaryCandidate}\n`)).ok).toBeFalse();
  } finally { await cleanup(root); }
}, 30_000);

test("pre-push reject-new rejects new findings and immutable-range ambiguity", async () => {
  const root = await repo(); try {
    const writePolicy = (extra = "") => writeFile(join(root, "atdd-bun.yaml"), `profiles: [flow, traceability]\nratchet: { mode: reject-new, profiles: [flow, traceability] }\n${extra}`);
    await writePolicy(); await mkdir(join(root, "plan"));
    await writeFile(join(root, "plan", "orders.yaml"), "urn: wmbt:orders:E001\nacceptances:\n  - identity: { urn: acc:orders:E001-UNIT-001 }\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "ratchet base", "--no-verify"]);
    const base = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    await writeFile(join(root, "plan", "payments.yaml"), "urn: wmbt:payments:E001\nacceptances:\n  - identity: { urn: acc:payments:E001-UNIT-001 }\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "new finding", "--no-verify"]);
    const withNewFinding = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    const newFinding = await runHook("pre-push", root, [], `refs/heads/feature ${withNewFinding} refs/heads/feature ${base}\n`);
    expect(newFinding.ok).toBeFalse(); expect(JSON.parse(newFinding.message)).toMatchObject({ new: [expect.any(String)] });

    await writePolicy("topology: { plan_root: contracts }\n"); await git(root, ["add", "atdd-bun.yaml"]); await git(root, ["commit", "-qm", "context drift", "--no-verify"]);
    const contextDrift = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    expect((await runHook("pre-push", root, [], `refs/heads/feature ${contextDrift} refs/heads/feature ${withNewFinding}\n`)).message).toContain("profile/context differ");

    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [workflow, traceability]\nratchet: { mode: reject-new, profiles: [flow, traceability] }\n");
    await git(root, ["add", "atdd-bun.yaml"]); await git(root, ["commit", "-qm", "legacy profile", "--no-verify"]);
    const legacyProfile = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    expect((await runHook("pre-push", root, [], `refs/heads/feature ${legacyProfile} refs/heads/feature ${contextDrift}\n`)).message).toContain("profile state is invalid");

    await git(root, ["checkout", "-qb", "unrelated", base]); await writeFile(join(root, "unrelated.md"), "unrelated\n"); await git(root, ["add", "."]); await git(root, ["commit", "-qm", "unrelated", "--no-verify"]);
    const unrelated = (await git(root, ["rev-parse", "HEAD"])).out.trim(); await git(root, ["checkout", "feature"]);
    expect((await runHook("pre-push", root, [], `refs/heads/feature ${legacyProfile} refs/heads/feature ${unrelated}\n`)).message).toContain("must be an ancestor");
  } finally { await cleanup(root); }
}, 60_000);

test("pre-push retains protected-destination and commit-count gates", async () => {
  const root = await repo(); try {
    await writeFile(join(root, "readme.md"), "second commit\n"); await git(root, ["add", "readme.md"]); await git(root, ["commit", "-qm", "second", "--no-verify"]);
    const head = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    expect((await runHook("pre-push", root, [], `refs/heads/feature ${head} refs/heads/main 0000000000000000000000000000000000000000\n`)).ok).toBeFalse();
    await writeFile(join(root, "atdd-bun.yaml"), "max_commits_per_push: 0\n");
    const parent = (await git(root, ["rev-parse", "HEAD~1"])).out.trim();
    expect((await runHook("pre-push", root, [], `refs/heads/feature ${head} refs/heads/feature ${parent}\n`)).message).toContain("commits per push 1 exceed 0");
  } finally { await cleanup(root); }
}, 20_000);

test("pre-push fails closed on a protected destination and post-commit remains advisory without network or ATDD", async () => {
  const root = await repo(); try { await installHooks(root); const head = (await git(root, ["rev-parse", "HEAD"])).out.trim(); expect((await runHook("pre-push", root, [], `refs/heads/feature ${head} refs/heads/main 0000000000000000000000000000000000000000\n`)).ok).toBeFalse(); expect((await runHook("post-commit", root)).ok).toBeTrue(); const dispatcher = await readFile(join(root, ".githooks", "pre-commit"), "utf8"); expect(dispatcher).not.toContain("http"); expect(dispatcher).not.toContain("bunx"); expect(dispatcher).not.toContain("atdd "); }
  finally { await cleanup(root); }
}, 20_000);

async function mergedWorktreeWithGeneratedHookIdentityDrift(branch: string) {
  const layout = await worktreeLayout(), feature = join(layout.worktrees, branch);
  await mkdir(layout.worktrees, { recursive: true });
  expect((await git(layout.main, ["worktree", "add", "-q", "-b", branch, feature])).code).toBe(0);
  expect((await installHooks(feature)).ok).toBeTrue();
  for (const event of hookEvents) {
    const path = join(feature, ".githooks", event), generated = await readFile(path, "utf8");
    const stale = generated.replace(/(# atdd-bun enforcement identity: )[a-f0-9]+/, `$1${"0".repeat(64)}`);
    expect(stale).not.toBe(generated);
    await writeFile(path, stale);
  }
  await git(feature, ["add", ".githooks"]);
  expect((await git(feature, ["commit", "-qm", "track stale generated hooks", "--no-verify"])).code).toBe(0);
  expect((await git(layout.main, ["merge", "--no-ff", branch, "-m", `merge ${branch}`])).code).toBe(0);
  expect((await installHooks(feature, true)).ok).toBeTrue();
  return { ...layout, feature };
}

const generatedHookDriftStatus = [...hookEvents].map(event => ` M .githooks/${event}`).sort();
const statusLines = async (root: string) => (await git(root, ["status", "--porcelain"])).out.split("\n").filter(Boolean).sort();

// RED: current finishWorktree rejects these six exact generated paths instead of safely force-removing the merged worktree.
test("finish generated hook drift removes exactly six tracked identity-only generated hook modifications", async () => {
  const layout = await mergedWorktreeWithGeneratedHookIdentityDrift("generated-only");
  try {
    expect(await statusLines(layout.feature)).toEqual(generatedHookDriftStatus);
    const result = await finishWorktree(layout.feature);
    expect(result.ok).toBeTrue();
    expect(existsSync(layout.feature)).toBeFalse();
  } finally { await cleanup(layout.container); }
}, 30_000);

test("finish generated hook drift refuses a mixed tracked non-hook change without touching it", async () => {
  const layout = await mergedWorktreeWithGeneratedHookIdentityDrift("mixed-tracked");
  try {
    const readme = join(layout.feature, "readme.md"); await writeFile(readme, "user work\n");
    const beforeStatus = await statusLines(layout.feature);
    expect(beforeStatus).toEqual([...generatedHookDriftStatus, " M readme.md"].sort());
    const result = await finishWorktree(layout.feature);
    expect(result.ok).toBeFalse(); expect(result.message).toContain("dirty");
    expect(await readFile(readme, "utf8")).toBe("user work\n");
    expect(await statusLines(layout.feature)).toEqual(beforeStatus);
  } finally { await cleanup(layout.container); }
}, 30_000);

test("finish generated hook drift refuses user-edited generated hook content without touching it", async () => {
  const layout = await mergedWorktreeWithGeneratedHookIdentityDrift("user-edited-hook");
  try {
    const hook = join(layout.feature, ".githooks", hookEvents[0]), userContent = `${await readFile(hook, "utf8")}# user-owned edit\n`;
    await writeFile(hook, userContent);
    const beforeStatus = await statusLines(layout.feature);
    expect(beforeStatus).toEqual(generatedHookDriftStatus);
    expect((await finishWorktree(layout.feature)).ok).toBeFalse();
    expect(await readFile(hook, "utf8")).toBe(userContent);
    expect(await statusLines(layout.feature)).toEqual(beforeStatus);
  } finally { await cleanup(layout.container); }
}, 30_000);

test("finish generated hook drift refuses an untracked githooks path without touching it", async () => {
  const layout = await mergedWorktreeWithGeneratedHookIdentityDrift("untracked-hook");
  try {
    const untracked = join(layout.feature, ".githooks", "user-hook"); await writeFile(untracked, "user work\n");
    const beforeStatus = await statusLines(layout.feature);
    expect(beforeStatus).toEqual([...generatedHookDriftStatus, "?? .githooks/user-hook"].sort());
    const result = await finishWorktree(layout.feature);
    expect(result.ok).toBeFalse(); expect(result.message).toContain("dirty");
    expect(await readFile(untracked, "utf8")).toBe("user work\n");
    expect(await statusLines(layout.feature)).toEqual(beforeStatus);
  } finally { await cleanup(layout.container); }
}, 30_000);

test("worktree policy requires a main primary checkout and linked feature worktrees in the configured root", async () => {
  const layout = await worktreeLayout(); const feature = join(layout.worktrees, "feature-x"), outside = join(layout.container, "outside");
  try {
    await git(layout.main, ["checkout", "-qb", "feature-primary"]);
    expect((await runHook("pre-commit", layout.main)).ok).toBeFalse();
    expect((await startWorktree(layout.main, "feature/x")).ok).toBeFalse();
    await git(layout.main, ["checkout", "main"]);

    expect((await startWorktree(layout.main, "feature/x")).ok).toBeTrue();
    expect((await hooksStatus(feature)).ok).toBeTrue();
    expect((await runHook("pre-commit", feature)).ok).toBeTrue();
    expect((await worktreeStatus(feature)).message).toContain(feature);

    expect((await git(layout.main, ["worktree", "add", "-q", "-b", "outside", outside])).code).toBe(0);
    expect((await runHook("pre-commit", outside)).ok).toBeFalse();
    await git(layout.main, ["worktree", "remove", outside]);

    await writeFile(join(feature, "feature.md"), "done\n"); await git(feature, ["add", "feature.md"]); await git(feature, ["commit", "-qm", "feature", "--no-verify"]);
    expect((await finishWorktree(feature)).ok).toBeFalse();
    await git(layout.main, ["merge", "--no-ff", "feature/x", "-m", "merge feature"]);
    expect((await finishWorktree(feature, true)).ok).toBeTrue();
    expect(existsSync(feature)).toBeFalse();
  } finally { await cleanup(layout.container); }
}, 30_000);

test("finish and status read worktree policy from the primary checkout, not a pre-policy linked worktree", async () => {
  const layout = await worktreeLayout(false), old = join(layout.worktrees, "old"), dirty = join(layout.worktrees, "dirty"), unmerged = join(layout.worktrees, "unmerged"), outside = join(layout.container, "outside"), protectedTree = join(layout.worktrees, "protected");
  try {
    await mkdir(layout.worktrees, { recursive: true });
    for (const [path, branch] of [[old, "old"], [dirty, "dirty"], [unmerged, "unmerged"], [outside, "outside"], [protectedTree, "release"]] as const) expect((await git(layout.main, ["worktree", "add", "-q", "-b", branch, path])).code).toBe(0);
    await writeFile(join(layout.main, "atdd-bun.yaml"), "protected_branches: [release]\nworktrees:\n  enabled: true\n"); await git(layout.main, ["add", "."]); await git(layout.main, ["commit", "-qm", "policy"]);
    expect(existsSync(join(old, "atdd-bun.yaml"))).toBeFalse();

    // The policy lives only in the primary checkout's committed HEAD; the linked worktree's own tree predates it.
    expect((await worktreeStatus(old)).message).toContain("worktree ");

    await writeFile(join(unmerged, "unmerged.md"), "work\n"); await git(unmerged, ["add", "."]); await git(unmerged, ["commit", "-qm", "unmerged", "--no-verify"]);
    await writeFile(join(dirty, "scratch.md"), "dirty\n");
    expect((await finishWorktree(unmerged)).message).toContain("not merged");
    expect((await finishWorktree(dirty)).message).toContain("dirty");
    expect((await finishWorktree(outside)).message).toContain("finish must run from a linked worktree beneath");
    expect((await finishWorktree(protectedTree)).message).toContain("non-protected");
    expect((await finishWorktree(layout.main)).message).toContain("finish must run from a linked worktree beneath");
    for (const path of [unmerged, dirty, outside, protectedTree]) expect(existsSync(path)).toBeTrue();

    const result = await finishWorktree(old, true);
    expect(result.message).toContain("removed merged worktree");
    expect(result.ok).toBeTrue();
    expect(existsSync(old)).toBeFalse();
    expect((await git(layout.main, ["branch", "--list", "old"])).out.trim()).toBe("");
  } finally { await cleanup(layout.container); }
}, 30_000);

test("finish --delete-branch removes worktree and branch when the merged branch is ahead of its upstream", async () => {
  const layout = await worktreeLayout(), ahead = join(layout.worktrees, "ahead"), unmerged = join(layout.worktrees, "unmerged");
  try {
    await mkdir(layout.worktrees, { recursive: true });
    await git(layout.main, ["branch", "stale-upstream"]);
    for (const [path, branch] of [[ahead, "ahead"], [unmerged, "unmerged"]] as const) expect((await git(layout.main, ["worktree", "add", "-q", "-b", branch, path])).code).toBe(0);
    expect((await git(ahead, ["branch", "--set-upstream-to=stale-upstream"])).code).toBe(0);
    expect((await git(unmerged, ["branch", "--set-upstream-to=stale-upstream"])).code).toBe(0);
    for (const path of [ahead, unmerged]) { await writeFile(join(path, "work.md"), `${path}\n`); await git(path, ["add", "work.md"]); await git(path, ["commit", "-qm", "work", "--no-verify"]); }
    await git(layout.main, ["merge", "--no-ff", "ahead", "-m", "merge ahead"]);

    const refused = await finishWorktree(unmerged, true);
    expect(refused.ok).toBeFalse(); expect(refused.message).toContain("not merged");
    expect(existsSync(unmerged)).toBeTrue();
    expect((await git(layout.main, ["branch", "--list", "unmerged"])).out.trim()).not.toBe("");

    const result = await finishWorktree(ahead, true);
    expect(result.message).toContain("removed merged worktree");
    expect(result.ok).toBeTrue();
    expect(existsSync(ahead)).toBeFalse();
    expect((await git(layout.main, ["branch", "--list", "ahead"])).out.trim()).toBe("");
  } finally { await cleanup(layout.container); }
}, 30_000);

test("finish and status stay disabled when the primary checkout's committed HEAD lacks the worktree policy", async () => {
  const layout = await worktreeLayout(false), old = join(layout.worktrees, "old");
  try {
    await mkdir(layout.worktrees, { recursive: true });
    expect((await git(layout.main, ["worktree", "add", "-q", "-b", "old", old])).code).toBe(0);
    const primary = await realpath(layout.main), primaryCommit = (await git(primary, ["rev-parse", "HEAD^{commit}"])).out.trim();
    await writeFile(join(layout.main, "atdd-bun.yaml"), "worktrees:\n  enabled: true\n"); // uncommitted
    const status = await worktreeStatus(old), refused = await finishWorktree(old);
    for (const result of [status, refused]) {
      expect(result.ok).toBeFalse();
      expect(result.message).toContain("worktree policy is disabled");
      expect(result.message).toContain(primary);
      expect(result.message).toContain(primaryCommit);
      expect(result.message).toContain("update the primary checkout");
    }
    expect(existsSync(old)).toBeTrue();
  } finally { await cleanup(layout.container); }
}, 30_000);

test("the line cap counts a moved file by the edits it carries, not by its whole body twice", async () => {
  const root = await repo(); try {
    await installHooks(root);
    const body = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n") + "\n";
    await mkdir(join(root, "notes/old_place"), { recursive: true }); await writeFile(join(root, "notes/old_place/big.md"), body);
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "seed", "--no-verify"]);
    // A pure move: 400 lines on each side under --no-renames, zero edits.
    await mkdir(join(root, "notes/new-place"), { recursive: true }); await git(root, ["mv", "notes/old_place/big.md", "notes/new-place/big.md"]);
    expect((await runHook("pre-commit", root)).ok).toBeTrue();
    // A move that also rewrites the file is still measured by what it changes.
    await writeFile(join(root, "notes/new-place/big.md"), body.replaceAll("line", "changed")); await git(root, ["add", "-A"]);
    expect((await runHook("pre-commit", root)).message).toContain("exceed 350");
  } finally { await cleanup(root); }
}, 30_000);


test("the generated journey view is exempt from the size caps but never from the docs check", async () => {
  const { journeyDocs } = await import("../src/journey-docs");
  const root = await repo(); try {
    await installHooks(root);
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [docs]\n");
    const write = async (path: string, content: string) => { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), content); };
    await write("plan/_trains/orders/batch.yaml", "train_id: train:orders:batch\ntitle: Batch\ndescription: A batch runs.\nsequence:\n  - step: 1\n    intent: run\n    from: user:operator\n    to: wagon:orders\n    artifact: orders:batch\n");
    await write("plan/_trains/_interlockings/batch.yaml", "interlocking_id: interlocking:batch\ntitle: Batch\nentrypoint:\n  exposed: true\n  actions: [run_batch]\n  reason: null\n  surfaces: [backend]\nroutes:\n  - route_id: nominal\n    category: nominal\n    train_id: train:orders:batch\n    train_path: plan/_trains/orders/batch.yaml\n");
    await write("docs/index.adoc", "= Docs\n");
    await git(root, ["add", "."]); await git(root, ["commit", "-qm", "seed", "--no-verify"]);
    // A hand-written 400-line page where the view belongs passes the size cap and is refused by the docs check.
    await write("docs/purpose/journeys/index.adoc", Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n") + "\n");
    await git(root, ["add", "-A"]);
    const handwritten = await runHook("pre-commit", root);
    expect(handwritten.message).not.toContain("exceed");
    expect(handwritten.message).toContain("planner.docs.journey-view-current");
    // What the plan generates is accepted whatever its size.
    await rm(join(root, "docs/purpose/journeys"), { recursive: true, force: true });
    await journeyDocs({ root });
    await git(root, ["add", "-A"]);
    const generated = await runHook("pre-commit", root);
    expect(generated.message).not.toContain("exceed");
    expect(generated.message).not.toContain("planner.docs.journey-view-current");
  } finally { await cleanup(root); }
}, 60_000);

// The source repo's own atdd-bun.yaml is the system under test: its worktrees key must enable the linked-worktree
// policy for the real layout (primary ~/Github/<repo> on main, seats beneath ~/Github/.worktrees/<repo>).
const repoRoot = resolve(import.meta.dir, "..");
const frozenContext = "372404875390a2ec884398af38fde20792029bfb6412885dd5f7b37028a0daaf";

test("the source repo enables the linked-worktree policy with the .worktrees/{repo} layout and primary main", async () => {
  const { worktrees } = await policy(repoRoot);
  expect(worktrees).toEqual({ enabled: true, root: "../.worktrees/{repo}", primary_directory: ".", primary_branch: "main", require_linked_worktree: true });
});

test("the configured layout accepts a seat worktree and rejects commits from the primary checkout and outside the root", async () => {
  const container = await mkdtemp(join(tmpdir(), "atdd-bun-enable-worktrees-")), primary = join(container, "atdd-bun"), seat = join(container, ".worktrees", "atdd-bun", "seat"), outside = join(container, "elsewhere");
  try {
    await mkdir(primary);
    for (const args of [["init", "-q", "-b", "main"], ["config", "user.email", "wt@test"], ["config", "user.name", "Wt"]]) await git(primary, args);
    // Only the real worktrees key is carried over (plus an unrelated protected branch, so main's own protection does not
    // mask the worktree decision) and the ratchet gate stays out of the way.
    const configured = (Bun.YAML.parse(await readFile(join(repoRoot, "atdd-bun.yaml"), "utf8")) as Record<string, unknown>).worktrees;
    await writeFile(join(primary, "atdd-bun.yaml"), configured === undefined ? "protected_branches: [release]\n" : Bun.YAML.stringify({ protected_branches: ["release"], worktrees: configured }));
    await writeFile(join(primary, "readme.md"), "init\n"); await git(primary, ["add", "."]); await git(primary, ["commit", "-qm", "init", "--no-verify"]);
    expect((await git(primary, ["worktree", "add", "-q", "-b", "seat", seat])).code).toBe(0);
    expect((await git(primary, ["worktree", "add", "-q", "-b", "elsewhere", outside])).code).toBe(0);
    expect((await runHook("pre-commit", seat)).ok).toBeTrue();
    const direct = await runHook("pre-commit", primary);
    expect(direct.ok).toBeFalse(); expect(direct.message).toContain("linked worktree");
    const stray = await runHook("pre-commit", outside);
    expect(stray.ok).toBeFalse(); expect(stray.message).toContain("outside required root");
  } finally { await rm(container, { recursive: true, force: true }); }
}, 30_000);

test("the worktrees key leaves the frozen all-profile ratchet context digest unchanged", async () => {
  const config = Bun.YAML.parse(await readFile(join(repoRoot, "atdd-bun.yaml"), "utf8")) as Record<string, unknown>;
  expect(contextDigest(config, config.profiles as string[])).toBe(frozenContext);
  const { worktrees: _worktrees, ...withoutWorktrees } = config;
  expect(activationContextDigest(config)).toBe(activationContextDigest(withoutWorktrees));
  expect(Object.keys(config).filter(key => key !== "worktrees").sort()).toEqual(["profiles", "ratchet"]);
});

const zeroSha = "0".repeat(40);
const debt = "urn: wmbt:orders:E001\nacceptances:\n  - identity: { urn: acc:orders:E001-UNIT-001 }\n";
const rejectNew = (profiles = "flow, traceability", extra = "") => `profiles: [${profiles}]\nratchet: { mode: reject-new, profiles: [${profiles.split(", ").join(", ")}] }\n${extra}`;
const commitAll = async (root: string, message: string) => { await git(root, ["add", "-A"]); await git(root, ["commit", "-qm", message, "--no-verify"]); return (await git(root, ["rev-parse", "HEAD"])).out.trim(); };
const trackRemote = (root: string, name: string, sha: string) => git(root, ["update-ref", `refs/remotes/${name}`, sha]);

async function ratchetedMain() {
  const root = await repo();
  await writeFile(join(root, "atdd-bun.yaml"), rejectNew()); await mkdir(join(root, "plan")); await writeFile(join(root, "plan", "orders.yaml"), debt);
  const base = await commitAll(root, "protected tip with carried debt"); await trackRemote(root, "origin/main", base);
  return { root, base };
}

test("pre-push ratchets a new remote branch against the one protected tip it descends from", async () => {
  const { root, base } = await ratchetedMain(); try {
    await writeFile(join(root, "readme.md"), "safe\n"); const safe = await commitAll(root, "safe candidate");
    const accepted = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${safe} refs/heads/feature ${zeroSha}\n`);
    expect(accepted.ok, accepted.message).toBeTrue();
    expect(JSON.parse(accepted.message)).toMatchObject({ mode: "reject-new", base, candidate: safe, carried: [expect.any(String)], new: [] });
    await writeFile(join(root, "plan", "payments.yaml"), debt.replaceAll("orders", "payments")); const bad = await commitAll(root, "new finding");
    const rejected = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${bad} refs/heads/feature ${zeroSha}\n`);
    expect(rejected.ok).toBeFalse(); expect(JSON.parse(rejected.message)).toMatchObject({ base, new: [expect.any(String)] });
  } finally { await cleanup(root); }
}, 60_000);

test("pre-push new-branch base fails closed with no, non-ancestor, or ambiguous protected tips", async () => {
  const { root, base } = await ratchetedMain(); try {
    await git(root, ["update-ref", "-d", "refs/remotes/origin/main"]);
    await writeFile(join(root, "readme.md"), "safe\n"); const safe = await commitAll(root, "safe candidate");
    const push = `refs/heads/feature ${safe} refs/heads/feature ${zeroSha}\n`;
    const none = await runHook("pre-push", root, ["origin"], push);
    expect(none.ok).toBeFalse(); expect(none.message).toContain("protected branch tip");
    await git(root, ["checkout", "-q", "-b", "unrelated", "HEAD~2"]); await writeFile(join(root, "other.md"), "x\n"); const other = await commitAll(root, "unrelated"); await git(root, ["checkout", "-q", "feature"]);
    await trackRemote(root, "origin/main", other);
    const unrelated = await runHook("pre-push", root, ["origin"], push);
    expect(unrelated.ok).toBeFalse(); expect(unrelated.message).toContain("protected branch tip");
    await trackRemote(root, "origin/main", base); await trackRemote(root, "origin/master", base);
    expect((await runHook("pre-push", root, ["origin"], push)).ok).toBeTrue();
    await trackRemote(root, "origin/master", (await git(root, ["rev-parse", "HEAD~2"])).out.trim());
    const ambiguous = await runHook("pre-push", root, ["origin"], push);
    expect(ambiguous.ok).toBeFalse(); expect(ambiguous.message).toContain("ambiguous");
  } finally { await cleanup(root); }
}, 60_000);

test("pre-push accepts one-time strict profile activation with identical context and rejects every other drift", async () => {
  const root = await repo(); try {
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow]\n"); await mkdir(join(root, "plan")); await writeFile(join(root, "plan", "orders.yaml"), debt);
    const base = await commitAll(root, "six-profile style base");
    await writeFile(join(root, "atdd-bun.yaml"), rejectNew()); const activated = await commitAll(root, "activate");
    const existing = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${activated} refs/heads/feature ${base}\n`);
    expect(existing.ok, existing.message).toBeTrue();
    expect(JSON.parse(existing.message)).toMatchObject({ base, candidate: activated, profiles: ["flow", "traceability"], new: [] });
    await trackRemote(root, "origin/main", base);
    const created = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${activated} refs/heads/feature ${zeroSha}\n`);
    expect(created.ok, created.message).toBeTrue(); expect(JSON.parse(created.message)).toMatchObject({ base, new: [] });

    await writeFile(join(root, "atdd-bun.yaml"), rejectNew("flow, traceability", "topology: { plan_root: contracts }\n")); const drift = await commitAll(root, "activation with context drift");
    expect((await runHook("pre-push", root, ["origin"], `refs/heads/feature ${drift} refs/heads/feature ${base}\n`)).message).toContain("profile/context differ");
    await writeFile(join(root, "atdd-bun.yaml"), rejectNew("traceability")); const swapped = await commitAll(root, "non-monotonic swap");
    expect((await runHook("pre-push", root, ["origin"], `refs/heads/feature ${swapped} refs/heads/feature ${base}\n`)).message).toContain("profile/context differ");
    await writeFile(join(root, "atdd-bun.yaml"), rejectNew()); await writeFile(join(root, "plan", "payments.yaml"), debt.replaceAll("orders", "payments")); const withNew = await commitAll(root, "activation plus new finding");
    const rejected = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${withNew} refs/heads/feature ${base}\n`);
    expect(rejected.ok).toBeFalse(); expect(JSON.parse(rejected.message)).toMatchObject({ new: [expect.any(String)] });
  } finally { await cleanup(root); }
}, 90_000);

test("pre-push activation accepts an implicit-default base and still rejects new findings and context drift", async () => {
  const root = await repo(); try {
    const all = `[${concreteProfiles.join(", ")}]`, policy = (extra = "") => `profiles: ${all}\nratchet: { mode: reject-new, profiles: ${all} }\n${extra}`;
    await mkdir(join(root, "plan")); await writeFile(join(root, "plan", "orders.yaml"), debt);
    const base = await commitAll(root, "implicit default base with carried debt");
    await writeFile(join(root, "atdd-bun.yaml"), policy()); const activated = await commitAll(root, "explicit full activation");
    const accepted = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${activated} refs/heads/feature ${base}\n`);
    expect(accepted.ok, accepted.message).toBeTrue();
    expect(JSON.parse(accepted.message)).toMatchObject({ base, candidate: activated, new: [] });
    expect(JSON.parse(accepted.message).carried.length).toBeGreaterThan(0);
    await writeFile(join(root, "atdd-bun.yaml"), policy("topology: { plan_root: contracts }\n")); const drift = await commitAll(root, "implicit base activation with context drift");
    expect((await runHook("pre-push", root, ["origin"], `refs/heads/feature ${drift} refs/heads/feature ${base}\n`)).message).toContain("profile/context differ");
    await writeFile(join(root, "atdd-bun.yaml"), policy()); await writeFile(join(root, "plan", "payments.yaml"), debt.replaceAll("orders", "payments")); const withNew = await commitAll(root, "implicit activation plus new finding");
    const rejected = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${withNew} refs/heads/feature ${base}\n`);
    expect(rejected.ok).toBeFalse(); expect(JSON.parse(rejected.message).new.length).toBeGreaterThan(0);
  } finally { await cleanup(root); }
}, 240_000);

test("strict pre-push runs detectors inside the live candidate snapshot, not a removed directory", async () => {
  const root = await repo(); try {
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [flow, traceability]\n"); await mkdir(join(root, "plan"));
    const base = await commitAll(root, "clean strict base");
    await writeFile(join(root, "readme.md"), "clean\n"); const clean = await commitAll(root, "clean candidate");
    const accepted = await runHook("pre-push", root, ["origin"], `refs/tags/v1 ${clean} refs/tags/v1 ${base}\n`);
    expect(accepted.ok, accepted.message).toBeTrue();
    await writeFile(join(root, "plan", "orders.yaml"), debt); const withFinding = await commitAll(root, "strict candidate with a finding");
    for (const stdin of [`refs/tags/v1 ${withFinding} refs/tags/v1 ${clean}\n`, `${withFinding} ${withFinding} refs/heads/x ${zeroSha}\n`]) {
      const rejected = await runHook("pre-push", root, ["origin"], stdin);
      expect(rejected.ok, rejected.message).toBeFalse();
      expect(rejected.message).not.toMatch(/ENOENT|resolution failed|scandir|posix_spawn/);
      expect(rejected.message).toContain("plan/orders.yaml");
    }
  } finally { await cleanup(root); }
}, 90_000);

async function mergedMain() {
  const root = await repo();
  await writeFile(join(root, "atdd-bun.yaml"), rejectNew()); await mkdir(join(root, "plan"));
  const p0 = await commitAll(root, "ratcheted main without debt"); await git(root, ["checkout", "-q", "-b", "feature"]);
  await writeFile(join(root, "feature.md"), "feature\n"); const remoteTip = await commitAll(root, "feature remote tip"); await trackRemote(root, "origin/feature", remoteTip);
  await git(root, ["checkout", "-q", "-B", "main", p0]); await writeFile(join(root, "plan", "orders.yaml"), debt); const mainTip = await commitAll(root, "main gains carried debt"); await trackRemote(root, "origin/main", mainTip);
  await git(root, ["checkout", "-q", "feature"]); expect((await git(root, ["merge", "-q", "--no-ff", "-m", "merge main", "main"])).code).toBe(0);
  const candidate = (await git(root, ["rev-parse", "HEAD"])).out.trim();
  return { root, p0, remoteTip, mainTip, candidate };
}

test("pre-push on an existing branch carries findings present at the merged protected tip and still rejects new ones", async () => {
  const { root, remoteTip, mainTip, candidate } = await mergedMain(); try {
    const accepted = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${candidate} refs/heads/feature ${remoteTip}\n`);
    expect(accepted.ok, accepted.message).toBeTrue();
    expect(JSON.parse(accepted.message)).toMatchObject({ base: remoteTip, protected_base: mainTip, candidate, carried: [expect.any(String)], new: [] });
    await writeFile(join(root, "plan", "payments.yaml"), debt.replaceAll("orders", "payments")); const bad = await commitAll(root, "new finding");
    const rejected = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${bad} refs/heads/feature ${remoteTip}\n`);
    expect(rejected.ok).toBeFalse(); expect(JSON.parse(rejected.message)).toMatchObject({ new: [expect.any(String)] });
  } finally { await cleanup(root); }
}, 90_000);

test("pre-push existing-branch protected base uses the remote tip alone when none qualifies and fails closed when ambiguous", async () => {
  const { root, p0, remoteTip, mainTip, candidate } = await mergedMain(); try {
    const push = `refs/heads/feature ${candidate} refs/heads/feature ${remoteTip}\n`;
    await git(root, ["update-ref", "-d", "refs/remotes/origin/main"]);
    const none = await runHook("pre-push", root, ["origin"], push);
    expect(none.ok).toBeFalse(); expect(JSON.parse(none.message)).toMatchObject({ base: remoteTip, new: [expect.any(String)] });
    await trackRemote(root, "origin/main", mainTip); await trackRemote(root, "origin/master", p0);
    const ambiguous = await runHook("pre-push", root, ["origin"], push);
    expect(ambiguous.ok).toBeFalse(); expect(ambiguous.message).toContain("ambiguous");
  } finally { await cleanup(root); }
}, 90_000);

async function commitsOn(root: string, count: number, label: string) { let tip = ""; for (let i = 0; i < count; i++) { await writeFile(join(root, `${label}-${i}.md`), `${label} ${i}\n`); tip = await commitAll(root, `${label} ${i}`); } return tip; }
async function protectedMain() {
  const root = await repo(); await writeFile(join(root, "atdd-bun.yaml"), "max_commits_per_push: 2\n"); const base = await commitAll(root, "config");
  await git(root, ["checkout", "-q", "-b", "feature"]); const remoteTip = await commitsOn(root, 1, "feature-remote"); await trackRemote(root, "origin/feature", remoteTip);
  await git(root, ["checkout", "-q", "main"]).then(() => git(root, ["checkout", "-q", "-B", "main", base])); const mainTip = await commitsOn(root, 3, "protected"); await trackRemote(root, "origin/main", mainTip);
  return { root, base, remoteTip, mainTip };
}

test("pre-push counts only commits not already on a protected remote tip when a branch merged protected main", async () => {
  const { root, remoteTip } = await protectedMain(); try {
    await git(root, ["checkout", "-q", "feature"]); expect((await git(root, ["merge", "-q", "--no-ff", "-m", "merge main", "main"])).code).toBe(0);
    const merged = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    const result = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${merged} refs/heads/feature ${remoteTip}\n`);
    expect(result.ok, result.message).toBeTrue();
  } finally { await cleanup(root); }
}, 60_000);

test("pre-push judges a new remote branch by its real unshared commits, and an ordinary over-limit push is still refused", async () => {
  const { root, mainTip } = await protectedMain(); try {
    await git(root, ["checkout", "-q", "-B", "fresh", mainTip]); const fresh = await commitsOn(root, 3, "fresh");
    const refused = await runHook("pre-push", root, ["origin"], `refs/heads/fresh ${fresh} refs/heads/fresh ${zeroSha}\n`);
    expect(refused.ok).toBeFalse(); expect(refused.message).toContain("commits per push 3 exceed 2");
    const firstOwn = (await git(root, ["rev-parse", `${fresh}~2`])).out.trim();
    const small = await runHook("pre-push", root, ["origin"], `refs/heads/fresh ${firstOwn} refs/heads/fresh ${zeroSha}\n`);
    expect(small.ok, small.message).toBeTrue();
    const ordinary = await runHook("pre-push", root, ["origin"], `refs/heads/fresh ${fresh} refs/heads/fresh ${mainTip}\n`);
    expect(ordinary.ok).toBeFalse(); expect(ordinary.message).toContain("commits per push 3 exceed 2");
  } finally { await cleanup(root); }
}, 60_000);

test("pre-push keeps the plain range count with no protected remote tip and never excludes local-only protected commits", async () => {
  const { root, remoteTip } = await protectedMain(); try {
    await git(root, ["update-ref", "-d", "refs/remotes/origin/main"]);
    await git(root, ["checkout", "-q", "feature"]); expect((await git(root, ["merge", "-q", "--no-ff", "-m", "merge main", "main"])).code).toBe(0);
    const merged = (await git(root, ["rev-parse", "HEAD"])).out.trim();
    const local = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${merged} refs/heads/feature ${remoteTip}\n`);
    expect(local.ok).toBeFalse(); expect(local.message).toContain("commits per push 4 exceed 2");
    const fresh = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${remoteTip} refs/heads/feature ${zeroSha}\n`);
    expect(fresh.ok, fresh.message).toBeTrue();
  } finally { await cleanup(root); }
}, 60_000);

async function withBareRemote(max = 2) {
  const root = await repo(); await writeFile(join(root, "atdd-bun.yaml"), `max_commits_per_push: ${max}\n`); const base = await commitAll(root, "config");
  const bare = await mkdtemp(join(tmpdir(), "atdd-bun-bare-")); await git(bare, ["init", "-q", "--bare", "-b", "main"]); await git(root, ["remote", "add", "origin", bare]);
  await pushAndTrack(root, "main", base);
  return { root, bare, base };
}
async function pushAndTrack(root: string, branch: string, sha: string) { expect((await git(root, ["push", "-q", "--no-verify", "origin", `${sha}:refs/heads/${branch}`])).code).toBe(0); expect((await git(root, ["fetch", "-q", "origin"])).code).toBe(0); }

test("pre-push counts only commits new to the push remote when a new branch carries commits already on another remote branch", async () => {
  const { root, bare, base } = await withBareRemote(); try {
    await git(root, ["checkout", "-q", "-b", "umbrella"]); const umbrella = await commitsOn(root, 5, "umbrella"); await pushAndTrack(root, "umbrella", umbrella);
    const reused = await runHook("pre-push", root, ["origin"], `refs/heads/integration ${umbrella} refs/heads/integration ${zeroSha}\n`);
    expect(reused.ok, reused.message).toBeTrue();
    const extra = await commitsOn(root, 3, "extra");
    const over = await runHook("pre-push", root, ["origin"], `refs/heads/integration ${extra} refs/heads/integration ${zeroSha}\n`);
    expect(over.ok).toBeFalse(); expect(over.message).toContain("commits per push 3 exceed 2");
    const ordinary = await runHook("pre-push", root, ["origin"], `refs/heads/umbrella ${extra} refs/heads/umbrella ${umbrella}\n`);
    expect(ordinary.ok).toBeFalse(); expect(ordinary.message).toContain("commits per push 3 exceed 2");
    expect(base).toHaveLength(40);
  } finally { await cleanup(root); await cleanup(bare); }
}, 60_000);

test("pre-push ignores a stale remote-tracking ref the remote no longer advertises, never local branches, and fails closed to protected-only when ls-remote fails", async () => {
  const { root, bare } = await withBareRemote(); try {
    await git(root, ["checkout", "-q", "-b", "umbrella"]); const umbrella = await commitsOn(root, 5, "umbrella"); await pushAndTrack(root, "umbrella", umbrella);
    const push = `refs/heads/integration ${umbrella} refs/heads/integration ${zeroSha}\n`;
    expect((await runHook("pre-push", root, ["origin"], push)).ok).toBeTrue();
    expect((await git(bare, ["branch", "-q", "-D", "umbrella"])).code).toBe(0);
    const stale = await runHook("pre-push", root, ["origin"], push);
    expect(stale.ok).toBeFalse(); expect(stale.message).toContain("commits per push 5 exceed 2");
    expect((await git(root, ["fetch", "-q", "origin"])).code).toBe(0);
    await git(root, ["checkout", "-q", "-b", "local-only", umbrella]);
    const local = await runHook("pre-push", root, ["origin"], push);
    expect(local.ok).toBeFalse(); expect(local.message).toContain("commits per push 5 exceed 2");
    await pushAndTrack(root, "umbrella", umbrella);
    await git(root, ["remote", "set-url", "origin", join(bare, "missing")]);
    const unreadable = await runHook("pre-push", root, ["origin"], push);
    expect(unreadable.ok).toBeFalse(); expect(unreadable.message).toContain("commits per push 5 exceed 2");
  } finally { await cleanup(root); await cleanup(bare); }
}, 60_000);

test("pre-push exempts only the SHAs the remote advertises: a remote branch rewound since the last fetch no longer exempts the newer local tracking commits", async () => {
  const { root, bare } = await withBareRemote(); try {
    await git(root, ["checkout", "-q", "-b", "umbrella"]); const umbrella = await commitsOn(root, 5, "umbrella"); await pushAndTrack(root, "umbrella", umbrella);
    const push = `refs/heads/integration ${umbrella} refs/heads/integration ${zeroSha}\n`;
    expect((await runHook("pre-push", root, ["origin"], push)).ok).toBeTrue();
    const older = (await git(root, ["rev-parse", `${umbrella}~3`])).out.trim();
    expect((await git(bare, ["update-ref", "refs/heads/umbrella", older])).code).toBe(0);
    expect((await git(root, ["rev-parse", "refs/remotes/origin/umbrella"])).out.trim()).toBe(umbrella);
    const rewound = await runHook("pre-push", root, ["origin"], push);
    expect(rewound.ok).toBeFalse(); expect(rewound.message).toContain("commits per push 3 exceed 2");
  } finally { await cleanup(root); await cleanup(bare); }
}, 60_000);

/** Record every enforce() call by the exact tree it scanned and the profiles it selected; `stub` skips the detectors. */
function watchEnforce(stub = false) {
  const original = enforcer.enforce, calls: Array<{ tree: string; profiles: string[] }> = [];
  const spy = spyOn(enforcer, "enforce").mockImplementation(async (config = {}) => {
    calls.push({ tree: (await git(config.root!, ["rev-parse", "HEAD^{tree}"])).out.trim(), profiles: [...(config.profiles ?? [])] });
    return stub ? [] : original(config);
  });
  return { calls, restore: () => spy.mockRestore() };
}
const treeOf = async (root: string, commit: string) => (await git(root, ["rev-parse", `${commit}^{tree}`])).out.trim();
const findingsCache = (root: string) => join(root, ".git", "atdd-bun", "findings-cache");

test("strict pre-push selects the pre-commit affected-area profiles for a code-only change, not the full fleet", async () => {
  const root = await repo(), watch = watchEnforce(true); try {
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [traceability, topology, planner, coder, tester, security]\n"); const base = await commitAll(root, "strict base");
    await mkdir(join(root, "src")); await writeFile(join(root, "src", "orders.ts"), "export const orders = 1;\n"); const code = await commitAll(root, "code-only change");
    const result = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${code} refs/heads/feature ${base}\n`);
    expect(result.ok, result.message).toBeTrue();
    expect(watch.calls.map(call => call.profiles)).toEqual([["coder", "tester"]]);
  } finally { watch.restore(); await cleanup(root); }
}, 30_000);

test("strict pre-push still selects planner, traceability and topology when atdd-bun.yaml or a registry path changes", async () => {
  const root = await repo(), watch = watchEnforce(true); try {
    await writeFile(join(root, "atdd-bun.yaml"), "profiles: [traceability, topology, planner, coder, tester]\n"); const base = await commitAll(root, "strict base");
    await writeFile(join(root, "atdd-bun.yaml"), "# touched\nprofiles: [traceability, topology, planner, coder, tester]\n"); const config = await commitAll(root, "policy change");
    await mkdir(join(root, "contracts")); await writeFile(join(root, "contracts", "_orders.yaml"), "contracts: []\n"); const registry = await commitAll(root, "registry change");
    for (const [from, to] of [[base, config], [config, registry]]) {
      const result = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${to} refs/heads/feature ${from}\n`);
      expect(result.ok, result.message).toBeTrue();
    }
    expect(watch.calls.map(call => [...call.profiles].sort())).toEqual([["planner", "topology", "traceability"], ["planner", "topology", "traceability"]]);
  } finally { watch.restore(); await cleanup(root); }
}, 30_000);

async function ratchetedPush() {
  const root = await repo();
  await writeFile(join(root, "atdd-bun.yaml"), rejectNew()); await mkdir(join(root, "plan")); await writeFile(join(root, "plan", "orders.yaml"), debt);
  const base = await commitAll(root, "ratchet base with carried debt");
  await writeFile(join(root, "readme.md"), "safe\n"); const safe = await commitAll(root, "safe candidate");
  return { root, base, safe, push: `refs/heads/feature ${safe} refs/heads/feature ${base}\n` };
}

test("ratchet pre-push run twice on the same base computes base findings once with an identical verdict", async () => {
  const { root, base, push } = await ratchetedPush(), watch = watchEnforce(); try {
    const first = await runHook("pre-push", root, ["origin"], push), second = await runHook("pre-push", root, ["origin"], push);
    expect(first.ok, first.message).toBeTrue(); expect(JSON.parse(first.message)).toMatchObject({ carried: [expect.any(String)], new: [] });
    expect(second.ok).toBeTrue(); expect(second.message).toBe(first.message);
    const baseTree = await treeOf(root, base);
    expect(watch.calls.filter(call => call.tree === baseTree)).toHaveLength(1);
  } finally { watch.restore(); await cleanup(root); }
}, 60_000);

test("ratchet pre-push ignores and recomputes a mismatched or corrupt findings cache entry", async () => {
  const { root, base, push } = await ratchetedPush(), watch = watchEnforce(); try {
    const first = await runHook("pre-push", root, ["origin"], push);
    expect(first.ok, first.message).toBeTrue();
    const entries = (await readdir(findingsCache(root))).map(name => join(findingsCache(root), name));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) { const data = JSON.parse(await readFile(entry, "utf8")); await writeFile(entry, JSON.stringify({ ...data, key: { ...data.key, tree: zeroSha }, findings: [] })); }
    const mismatched = await runHook("pre-push", root, ["origin"], push);
    for (const entry of entries) await writeFile(entry, "{ not json");
    const corrupt = await runHook("pre-push", root, ["origin"], push);
    expect(mismatched.message).toBe(first.message); expect(corrupt.message).toBe(first.message);
    const baseTree = await treeOf(root, base);
    expect(watch.calls.filter(call => call.tree === baseTree)).toHaveLength(3);
  } finally { watch.restore(); await cleanup(root); }
}, 90_000);

test("ratchet pre-push still rejects a new candidate finding with a warm base cache", async () => {
  const { root, base, push } = await ratchetedPush(), watch = watchEnforce(); try {
    expect((await runHook("pre-push", root, ["origin"], push)).ok).toBeTrue();
    await writeFile(join(root, "plan", "payments.yaml"), debt.replaceAll("orders", "payments")); const bad = await commitAll(root, "new finding");
    const rejected = await runHook("pre-push", root, ["origin"], `refs/heads/feature ${bad} refs/heads/feature ${base}\n`);
    expect(rejected.ok).toBeFalse(); expect(JSON.parse(rejected.message)).toMatchObject({ base, candidate: bad, carried: [expect.any(String)], new: [expect.any(String)] });
    const baseTree = await treeOf(root, base);
    expect(watch.calls.filter(call => call.tree === baseTree)).toHaveLength(1);
  } finally { watch.restore(); await cleanup(root); }
}, 90_000);

test("ratchet pre-push misses the findings cache when the toolkit version, detector digest or profile list changes", async () => {
  const { root, base, push } = await ratchetedPush(), watch = watchEnforce(); try {
    const first = await runHook("pre-push", root, ["origin"], push);
    expect(first.ok, first.message).toBeTrue();
    const cache = await import("../src/hooks"), real = await cache.toolkitIdentity();
    for (const changed of [{ ...real, version: `${real.version}-other` }, { ...real, digest: "0".repeat(64) }]) {
      const identity = spyOn(cache, "toolkitIdentity").mockResolvedValue(changed);
      try { expect((await runHook("pre-push", root, ["origin"], push)).message).toBe(first.message); } finally { identity.mockRestore(); }
    }
    const baseTree = await treeOf(root, base);
    expect(watch.calls.filter(call => call.tree === baseTree)).toHaveLength(3);
  } finally { watch.restore(); await cleanup(root); }

  const profiled = await repo(), again = watchEnforce(); try {
    await writeFile(join(profiled, "atdd-bun.yaml"), "profiles: [traceability]\n"); await mkdir(join(profiled, "plan")); await writeFile(join(profiled, "plan", "orders.yaml"), debt);
    const profileBase = await commitAll(profiled, "base with one profile");
    await writeFile(join(profiled, "atdd-bun.yaml"), rejectNew("traceability")); const same = await commitAll(profiled, "ratchet the same profile");
    await writeFile(join(profiled, "atdd-bun.yaml"), rejectNew("topology, traceability")); const expanded = await commitAll(profiled, "expand the profile list");
    for (const candidate of [same, same, expanded]) await runHook("pre-push", profiled, ["origin"], `refs/heads/feature ${candidate} refs/heads/feature ${profileBase}\n`);
    const baseTree = await treeOf(profiled, profileBase);
    expect(again.calls.filter(call => call.tree === baseTree).map(call => call.profiles)).toEqual([["traceability"], ["topology", "traceability"]]);
  } finally { again.restore(); await cleanup(profiled); }
}, 120_000);

const fullCommitRatchetProfiles = ["coder", "planner", "security", "tester", "topology", "traceability"];
const fullCommitRatchet = () => rejectNew("traceability, topology, planner, coder, tester, security");

async function commitRatchetRoot(profiles = fullCommitRatchet()) {
  const root = await repo();
  await writeFile(join(root, "atdd-bun.yaml"), profiles);
  await commitAll(root, "ratchet base");
  return root;
}

test("pre-commit incremental selects only configured affected profiles for a code-only reject-new candidate", async () => {
  const root = await commitRatchetRoot(), watch = watchEnforce(true); try {
    await mkdir(join(root, "src")); await writeFile(join(root, "src", "orders.ts"), "export const orders = 1;\n"); await git(root, ["add", "src/orders.ts"]);
    const result = await runHook("pre-commit", root);
    expect(result.ok, result.message).toBeTrue();
    expect(watch.calls.map(call => call.profiles)).toEqual([["coder", "tester"], ["coder", "tester"]]);
    expect(JSON.parse(result.message)).toMatchObject({ profiles: ["coder", "tester"], new: [] });
  } finally { watch.restore(); await cleanup(root); }
}, 30_000);

test("pre-commit incremental keeps the full profile set for config, activation, and detector-input changes", async () => {
  const cases: Array<{ label: string; setup: (root: string) => Promise<string[]>; expected: string[] }> = [
    {
      label: "atdd-bun.yaml", expected: fullCommitRatchetProfiles,
      setup: async root => { await writeFile(join(root, "atdd-bun.yaml"), `# touched\n${fullCommitRatchet()}`); return ["atdd-bun.yaml"]; },
    },
    {
      label: "profile activation", expected: ["flow", "traceability"],
      setup: async root => { await writeFile(join(root, "atdd-bun.yaml"), rejectNew("flow, traceability")); return ["atdd-bun.yaml"]; },
    },
    {
      label: "tsconfig.json", expected: fullCommitRatchetProfiles,
      setup: async root => { await writeFile(join(root, "tsconfig.json"), "{\"compilerOptions\": {}}\n"); return ["tsconfig.json"]; },
    },
  ];
  for (const { label, setup, expected } of cases) {
    const root = await repo(), watch = watchEnforce(true); try {
      await writeFile(join(root, "atdd-bun.yaml"), label === "profile activation" ? "profiles: [flow]\n" : fullCommitRatchet()); await commitAll(root, `${label} base`);
      await git(root, ["add", ...(await setup(root))]);
      const result = await runHook("pre-commit", root);
      expect(result.ok, `${label}: ${result.message}`).toBeTrue();
      expect(watch.calls.map(call => call.profiles), label).toEqual([expected, expected]);
      expect(JSON.parse(result.message).profiles, label).toEqual(expected);
    } finally { watch.restore(); await cleanup(root); }
  }
}, 60_000);

test("pre-commit incremental reuses the first candidate cache as the second commit base", async () => {
  const root = await repo(), watch = watchEnforce(true); try {
    await writeFile(join(root, "atdd-bun.yaml"), rejectNew("traceability")); await mkdir(join(root, "plan")); await writeFile(join(root, "plan", "orders.yaml"), debt);
    await commitAll(root, "ratchet base with debt");
    await writeFile(join(root, "plan", "orders.yaml"), `${debt}# first candidate\n`); await git(root, ["add", "plan/orders.yaml"]);
    expect((await runHook("pre-commit", root)).ok).toBeTrue();
    const first = await commitAll(root, "first safe candidate"), firstTree = await treeOf(root, first);
    await writeFile(join(root, "plan", "orders.yaml"), `${debt}# second candidate\n`); await git(root, ["add", "plan/orders.yaml"]);
    const second = await runHook("pre-commit", root);
    expect(second.ok, second.message).toBeTrue();
    expect(watch.calls.filter(call => call.tree === firstTree)).toHaveLength(1);
  } finally { watch.restore(); await cleanup(root); }
}, 60_000);

test("pre-commit incremental rejects a new finding with a warm base cache and recomputes corrupt entries", async () => {
  const root = await repo(), watch = watchEnforce(); try {
    await writeFile(join(root, "atdd-bun.yaml"), rejectNew()); await mkdir(join(root, "plan")); await writeFile(join(root, "plan", "orders.yaml"), debt);
    await commitAll(root, "ratchet base with debt");
    await writeFile(join(root, "plan", "orders.yaml"), `${debt}# first candidate\n`); await git(root, ["add", "plan/orders.yaml"]);
    expect((await runHook("pre-commit", root)).ok).toBeTrue();
    const first = await commitAll(root, "first safe candidate"), firstTree = await treeOf(root, first);
    await writeFile(join(root, "plan", "payments.yaml"), debt.replaceAll("orders", "payments")); await git(root, ["add", "plan/payments.yaml"]);
    const rejected = await runHook("pre-commit", root);
    expect(rejected.ok).toBeFalse(); expect(JSON.parse(rejected.message)).toMatchObject({ new: [expect.any(String)] });
    expect(watch.calls.filter(call => call.tree === firstTree)).toHaveLength(1);
  } finally { watch.restore(); await cleanup(root); }
}, 90_000);

test("pre-commit incremental recomputes corrupt findings-cache entries", async () => {
  const root = await repo(), watch = watchEnforce(true); try {
    await writeFile(join(root, "atdd-bun.yaml"), rejectNew("traceability")); await mkdir(join(root, "plan")); await writeFile(join(root, "plan", "orders.yaml"), debt);
    await commitAll(root, "ratchet base with debt");
    await writeFile(join(root, "plan", "orders.yaml"), `${debt}# first candidate\n`); await git(root, ["add", "plan/orders.yaml"]);
    expect((await runHook("pre-commit", root)).ok).toBeTrue();
    const first = await commitAll(root, "first safe candidate"), firstTree = await treeOf(root, first);
    const entries = (await readdir(findingsCache(root))).map(name => join(findingsCache(root), name));
    expect(entries.length).toBeGreaterThan(0); for (const entry of entries) await writeFile(entry, "{ corrupt");
    await writeFile(join(root, "plan", "orders.yaml"), `${debt}# second candidate\n`); await git(root, ["add", "plan/orders.yaml"]);
    const result = await runHook("pre-commit", root);
    expect(result.ok, result.message).toBeTrue();
    expect(watch.calls.filter(call => call.tree === firstTree)).toHaveLength(2);
  } finally { watch.restore(); await cleanup(root); }
}, 60_000);

test("pre-commit incremental enforces nothing for a reject-new commit touching no mapped area", async () => {
  const root = await commitRatchetRoot(), watch = watchEnforce(true); try {
    await writeFile(join(root, "readme.md"), "safe documentation-only change\n"); await git(root, ["add", "readme.md"]);
    const result = await runHook("pre-commit", root);
    expect(result.ok, result.message).toBeTrue();
    expect(watch.calls).toEqual([]);
    expect(JSON.parse(result.message)).toMatchObject({ profiles: [], new: [] });
  } finally { watch.restore(); await cleanup(root); }
}, 30_000);

test("pre-commit incremental rejects a cold-cache first candidate finding", async () => {
  const root = await repo(); try {
    await writeFile(join(root, "atdd-bun.yaml"), rejectNew("traceability")); await commitAll(root, "clean ratchet base");
    await mkdir(join(root, "plan")); await writeFile(join(root, "plan", "payments.yaml"), debt.replaceAll("orders", "payments")); await git(root, ["add", "plan/payments.yaml"]);
    const result = await runHook("pre-commit", root);
    expect(result.ok).toBeFalse(); expect(JSON.parse(result.message)).toMatchObject({ new: [expect.any(String)] });
  } finally { await cleanup(root); }
}, 30_000);
