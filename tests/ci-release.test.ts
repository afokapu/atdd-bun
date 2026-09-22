import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciInit } from "../src/ci";
import { releaseCheck } from "../src/release";
import { initializeRepository } from "../src/setup";

test("ci init is idempotent, preserves an existing workflow, and emits the required local workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-ci-")); try { expect((await ciInit(root)).ok).toBeTrue(); expect((await ciInit(root)).ok).toBeFalse(); const workflow = join(root, ".github/workflows/atdd-bun.yml"), content = await readFile(workflow, "utf8"); for (const term of ["pull_request:", "merge_group:", "actions/checkout@v4", "oven-sh/setup-bun@v2", "bun install --frozen-lockfile", "bun run atdd-bun all"]) expect(content).toContain(term); for (const forbidden of ["bunx", "atdd ", "python", "gh ", "curl", "wget"]) expect(content).not.toContain(forbidden); await writeFile(workflow, "kept\n"); expect((await ciInit(root)).ok).toBeFalse(); expect(await readFile(workflow, "utf8")).toBe("kept\n"); expect((await ciInit(root, true)).ok).toBeTrue(); } finally { await rm(root, { recursive: true, force: true }); }
});

test("repository bootstrap installs hooks and the CI workflow without replacing unrelated workflows", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-bootstrap-"));
  const git = async (...args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); return { code: await child.exited, stderr: await new Response(child.stderr).text() }; };
  try {
    expect((await git("init", "-q")).code).toBe(0);
    await mkdir(join(root, ".github/workflows"), { recursive: true });
    await writeFile(join(root, ".github/workflows/verify.yml"), "name: verify\n");
    expect((await initializeRepository(root)).ok).toBeTrue();
    expect(await readFile(join(root, ".github/workflows/verify.yml"), "utf8")).toBe("name: verify\n");
    expect((await Bun.file(join(root, ".githooks/pre-commit")).text()).length).toBeGreaterThan(0);
    expect(await Bun.file(join(root, ".github/workflows/atdd-bun.yml")).text()).toContain("atdd-bun");
    expect((await initializeRepository(root)).ok).toBeTrue();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release check is local, deterministic, and validates SemVer, intent, and reachable tags", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-release-")); const git = async (...args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); await child.exited; };
  try { await git("init", "-q"); await git("config", "user.email", "release@test"); await git("config", "user.name", "Release"); await writeFile(join(root, "package.json"), '{"version":"1.0.1"}\n'); await writeFile(join(root, "atdd-bun.yaml"), "release:\n  enabled: true\n  require_release_intent: true\n"); await mkdir(join(root, ".changeset")); await writeFile(join(root, ".changeset/decision.md"), "patch\n"); await git("add", "."); await git("commit", "-qm", "release"); await git("tag", "v1.0.0"); expect((await releaseCheck(root)).ok).toBeTrue(); await writeFile(join(root, "package.json"), '{"version":"broken"}\n'); expect((await releaseCheck(root)).ok).toBeFalse(); await writeFile(join(root, "package.json"), '{"version":"1.0.0"}\n'); expect((await releaseCheck(root)).ok).toBeFalse(); await writeFile(join(root, ".changeset/decision.md"), "invalid\n"); expect((await releaseCheck(root)).ok).toBeFalse(); } finally { await rm(root, { recursive: true, force: true }); }
});
