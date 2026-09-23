import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciInit } from "../src/ci";
import { agentInit, agentStatus } from "../src/agent";
import { releaseCheck } from "../src/release";
import { initializeRepository } from "../src/setup";

test("ci init is idempotent, preserves an existing workflow, and emits the required local workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-ci-")); try { expect((await ciInit(root)).ok).toBeTrue(); expect((await ciInit(root)).ok).toBeFalse(); const workflow = join(root, ".github/workflows/atdd-bun.yml"), content = await readFile(workflow, "utf8"); for (const term of ["pull_request:", "merge_group:", "actions/checkout@v4", "oven-sh/setup-bun@v2", "bun install --frozen-lockfile", "bun run atdd-bun all"]) expect(content).toContain(term); for (const forbidden of ["bunx", "atdd ", "python", "gh ", "curl", "wget"]) expect(content).not.toContain(forbidden); await writeFile(workflow, "kept\n"); expect((await ciInit(root)).ok).toBeFalse(); expect(await readFile(workflow, "utf8")).toBe("kept\n"); expect((await ciInit(root, true)).ok).toBeTrue(); } finally { await rm(root, { recursive: true, force: true }); }
});

test("agent init writes the skill for every agent and a managed AGENTS.md block, preserving existing content", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-agent-"));
  try {
    await writeFile(join(root, "AGENTS.md"), "# Team rules\n");
    expect((await agentInit(root)).ok).toBeTrue();
    for (const path of [".agents/skills/atdd/SKILL.md", ".claude/skills/atdd/SKILL.md"]) {
      const content = await readFile(join(root, path), "utf8");
      expect(content.startsWith("---\nname: atdd\ndescription: ")).toBeTrue();
      expect(content).not.toContain("{{VERSION}}");
      for (const stage of ["PLAN", "RED", "GREEN", "SMOKE", "REFACTOR", "TRACE"]) expect(content).toMatch(new RegExp(`\\d\\. ${stage} — `));
      for (const gate of ["atdd-bun planner", "atdd-bun tester", "atdd-bun coder security", "atdd-bun traceability", "atdd-bun all"]) expect(content).toContain(gate);
    }
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# Team rules\n\n<!-- atdd-bun:start")).toBeTrue();
    expect(agents).toContain(".agents/skills/atdd/SKILL.md");
    // Claude Code reads CLAUDE.md: the same block, saying what an agent may change.
    const claude = await readFile(join(root, "CLAUDE.md"), "utf8"), managed = /<!-- atdd-bun:start[\s\S]*<!-- atdd-bun:end -->/;
    expect(claude.match(managed)?.[0]).toBe(agents.match(managed)?.[0]);
    for (const text of ["Never modify the toolkit itself", "change only the configuration it offers", "enabled gradually", "profiles:"]) expect(claude).toContain(text);
    expect((await agentInit(root)).ok).toBeFalse();
    const skill = join(root, ".claude/skills/atdd/SKILL.md");
    await writeFile(skill, "kept\n"); expect((await agentInit(root)).ok).toBeFalse(); expect(await readFile(skill, "utf8")).toBe("kept\n");
    expect((await agentInit(root, true)).ok).toBeTrue(); expect(await readFile(skill, "utf8")).toContain("name: atdd");
    const replaced = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(replaced.match(/atdd-bun:start/g)?.length).toBe(1); expect(replaced.startsWith("# Team rules\n")).toBeTrue();
    expect((await agentStatus(root)).ok).toBeTrue();
    await writeFile(join(root, "CLAUDE.md"), "# mine\n"); expect((await agentStatus(root)).ok).toBeFalse();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("repository bootstrap installs hooks, the CI workflow, and the agent skill without replacing unrelated workflows", async () => {
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
    for (const path of [".agents/skills/atdd/SKILL.md", ".claude/skills/atdd/SKILL.md"]) expect(await Bun.file(join(root, path)).text()).toContain("name: atdd");
    expect(await Bun.file(join(root, "AGENTS.md")).text()).toContain("atdd-bun:start");
    expect((await initializeRepository(root)).ok).toBeTrue();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release check is local, deterministic, and validates SemVer, intent, and reachable tags", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-release-")); const git = async (...args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); await child.exited; };
  try { await git("init", "-q"); await git("config", "user.email", "release@test"); await git("config", "user.name", "Release"); await writeFile(join(root, "package.json"), '{"version":"1.0.1"}\n'); await writeFile(join(root, "atdd-bun.yaml"), "release:\n  enabled: true\n  require_release_intent: true\n"); await mkdir(join(root, ".changeset")); await writeFile(join(root, ".changeset/decision.md"), "patch\n"); await git("add", "."); await git("commit", "-qm", "release"); await git("tag", "v1.0.0"); expect((await releaseCheck(root)).ok).toBeTrue(); await writeFile(join(root, "package.json"), '{"version":"broken"}\n'); expect((await releaseCheck(root)).ok).toBeFalse(); await writeFile(join(root, "package.json"), '{"version":"1.0.0"}\n'); expect((await releaseCheck(root)).ok).toBeFalse(); await writeFile(join(root, ".changeset/decision.md"), "invalid\n"); expect((await releaseCheck(root)).ok).toBeFalse(); } finally { await rm(root, { recursive: true, force: true }); }
});
