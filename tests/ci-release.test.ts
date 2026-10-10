import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
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

test("generated CI grants only read access and supplies the ephemeral Actions token only to frozen package installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-private-package-"));
  const registryScope = "@forgeonehundred:registry=https://npm.pkg.github.com\n";
  const npmrc = registryScope + "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n";
  const lock = `{
  "lockfileVersion": 1,
  "packages": {
    "@forgeonehundred/resolver-os": ["@forgeonehundred/resolver-os@0.1.0", "", {}, "sha512-fixture"],
  }
}
`;
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { "@forgeonehundred/resolver-os": "0.1.0" } }));
    // FRG's tracked scope-only configuration cannot consume the CI token yet.
    await writeFile(join(root, ".npmrc"), registryScope);
    await writeFile(join(root, "bun.lock"), lock);
    expect((await ciInit(root)).ok).toBeTrue();
    const workflow = await readFile(join(root, ".github/workflows/atdd-bun.yml"), "utf8");

    expect((Bun.YAML.parse(workflow) as { permissions: unknown }).permissions).toEqual({ contents: "read", packages: "read" });
    expect(workflow).toContain("run: bun install --frozen-lockfile\n        env:\n          NODE_AUTH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toMatch(/(?:ghp_|github_pat_|NPM_TOKEN|GITHUB_TOKEN|npm[_-]?pat|github[_-]?pat)/i);
    expect(workflow.match(/NODE_AUTH_TOKEN/g)).toHaveLength(1);
    expect(workflow.match(/github\.token/g)).toHaveLength(1);
    expect(await readFile(join(root, ".npmrc"), "utf8")).toBe(npmrc);
    expect(await readFile(join(root, "bun.lock"), "utf8")).toBe(lock);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a scoped npm interpolation authenticates an isolated frozen Bun install without inheriting a token", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-private-package-install-"));
  const token = "fixture-ephemeral";
  const seen: Array<string | null> = [];
  let server: ReturnType<typeof Bun.serve>;
  const install = async (cwd: string, env: Record<string, string>, ...args: string[]) => {
    const child = Bun.spawn({ cmd: ["bun", "install", "--cwd", cwd, ...args], env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, output: stdout + stderr };
  };
  try {
    await mkdir(join(root, "package"));
    await writeFile(join(root, "package/package.json"), JSON.stringify({ name: "@forgeonehundred/resolver-os", version: "0.1.0" }));
    const tarball = join(root, "resolver-os-0.1.0.tgz");
    const archive = Bun.spawn({ cmd: ["tar", "-czf", tarball, "package"], cwd: root });
    expect(await archive.exited).toBe(0);
    const integrity = "sha512-" + createHash("sha512").update(new Uint8Array(await Bun.file(tarball).arrayBuffer())).digest("base64");
    server = Bun.serve({ port: 0, fetch(request) {
      const url = new URL(request.url);
      seen.push(request.headers.get("authorization"));
      if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response("unauthorized", { status: 401 });
      if (decodeURIComponent(url.pathname) === "/@forgeonehundred/resolver-os") return Response.json({ name: "@forgeonehundred/resolver-os", "dist-tags": { latest: "0.1.0" }, versions: { "0.1.0": { name: "@forgeonehundred/resolver-os", version: "0.1.0", dist: { tarball: `http://127.0.0.1:${server.port}/-/resolver-os-0.1.0.tgz`, integrity } } } });
      if (url.pathname === "/-/resolver-os-0.1.0.tgz") return new Response(Bun.file(tarball));
      return new Response("not found", { status: 404 });
    } });
    const consumer = join(root, "consumer");
    await mkdir(consumer);
    await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "fixture", dependencies: { "@forgeonehundred/resolver-os": "0.1.0" } }));
    await writeFile(join(consumer, ".npmrc"), `@forgeonehundred:registry=http://127.0.0.1:${server.port}\n//127.0.0.1:${server.port}/:_authToken=\${NODE_AUTH_TOKEN}\n`);
    const withoutToken = { ...process.env } as Record<string, string>;
    delete withoutToken.NODE_AUTH_TOKEN;
    expect((await install(consumer, withoutToken, "--cache-dir", join(root, "cache-without-token"))).code).not.toBe(0);
    expect(seen).toContain("Bearer ${NODE_AUTH_TOKEN}");
    const isolated = { ...withoutToken, NODE_AUTH_TOKEN: token };
    expect((await install(consumer, isolated, "--cache-dir", join(root, "cache-bootstrap"))).code).toBe(0);
    await rm(join(consumer, "node_modules"), { recursive: true, force: true });
    const frozen = await install(consumer, isolated, "--frozen-lockfile", "--force", "--cache-dir", join(root, "cache-frozen"));
    expect(frozen.code).toBe(0);
    expect(frozen.output).not.toContain(token);
    expect((await readFile(join(consumer, "bun.lock"), "utf8"))).toContain('"@forgeonehundred/resolver-os"');
    expect(seen.filter(value => value === `Bearer ${token}`).length).toBeGreaterThan(2);
  } finally { server?.stop(true); await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("ci init rejects duplicate GitHub Packages auth assignments in either order", async () => {
  const scope = "@forgeonehundred:registry=https://npm.pkg.github.com\n";
  for (const assignments of [
    "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n//npm.pkg.github.com/:_authToken=not-a-token-to-copy\n",
    "//npm.pkg.github.com/:_authToken=not-a-token-to-copy\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n",
  ]) {
    const root = await mkdtemp(join(tmpdir(), "atdd-private-package-duplicate-auth-"));
    try {
      const npmrc = scope + assignments;
      await writeFile(join(root, ".npmrc"), npmrc);
      const result = await ciInit(root);
      expect(result.ok).toBeFalse();
      expect(result.message).toContain("exactly one");
      expect(result.message).not.toContain("not-a-token-to-copy");
      expect(await readFile(join(root, ".npmrc"), "utf8")).toBe(npmrc);
      expect(await Bun.file(join(root, ".github/workflows/atdd-bun.yml")).exists()).toBeFalse();
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("ci init refuses a persisted GitHub Packages credential without changing consumer files", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-private-package-persisted-token-"));
  const npmrc = "@forgeonehundred:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=not-a-token-to-copy\n";
  try {
    await writeFile(join(root, ".npmrc"), npmrc);
    const result = await ciInit(root);
    expect(result.ok).toBeFalse();
    expect(result.message).toContain("standard ${NODE_AUTH_TOKEN} interpolation");
    expect(result.message).not.toContain("not-a-token-to-copy");
    expect(await readFile(join(root, ".npmrc"), "utf8")).toBe(npmrc);
    expect(await Bun.file(join(root, ".github/workflows/atdd-bun.yml")).exists()).toBeFalse();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("agent init writes one managed instruction block, preserving existing content", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-agent-"));
  try {
    await writeFile(join(root, "AGENTS.md"), "# Team rules\n");
    expect((await agentInit(root)).ok).toBeTrue();
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# Team rules\n\n<!-- atdd-bun:start")).toBeTrue();
    for (const text of ["two mandatory toolkits", "@afokapu/atdd-flow", "General discussion", "governed work", "installed `atdd-flow` command", "do not use `bunx`", "older package version", "`atdd-flow init` is only", "Never run it against an existing Desk", "native pane binding", "Do not create, choose, or reconfigure a Desk yourself", "assigned coordinator with delegated authority", "explicitly authorized scope"]) expect(agents).toContain(text);
    // Claude Code reads CLAUDE.md: the same block, saying what an agent may change.
    const claude = await readFile(join(root, "CLAUDE.md"), "utf8"), managed = /<!-- atdd-bun:start[\s\S]*<!-- atdd-bun:end -->/;
    expect(claude.match(managed)?.[0]).toBe(agents.match(managed)?.[0]);
    for (const text of ["two mandatory toolkits", "@afokapu/atdd-flow", "governed work", "installed `atdd-flow` command", "do not use `bunx`", "Never run it against an existing Desk", "native pane binding", "Do not create, choose, or reconfigure a Desk yourself", "explicitly authorized scope"]) expect(claude).toContain(text);
    expect((await agentInit(root)).ok).toBeFalse();
    const skill = join(root, ".claude/skills/atdd/SKILL.md");
    await mkdir(join(root, ".claude/skills/atdd"), { recursive: true }); await writeFile(skill, "retired\n");
    expect((await agentInit(root, true)).ok).toBeTrue(); expect(await Bun.file(skill).exists()).toBeFalse();
    const replaced = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(replaced.match(/atdd-bun:start/g)?.length).toBe(1); expect(replaced.startsWith("# Team rules\n")).toBeTrue();
    expect((await agentStatus(root)).ok).toBeTrue();
    const generatedSkill = join(root, ".agents/skills/atdd/SKILL.md");
    await mkdir(join(root, ".agents/skills/atdd"), { recursive: true }); await writeFile(generatedSkill, "<!-- Generated by @afokapu/atdd-bun 0.9.0 -->\n");
    expect((await agentStatus(root)).ok).toBeFalse(); expect((await agentInit(root)).ok).toBeTrue(); expect(await Bun.file(generatedSkill).exists()).toBeFalse();
    await writeFile(join(root, "CLAUDE.md"), "# mine\n"); expect((await agentStatus(root)).ok).toBeFalse();
    // The rest of an instruction file is never touched, trailing blank lines included.
    for (const own of ["# mine", "# mine\n", "# mine\n\n\n\n"]) {
      await writeFile(join(root, "CLAUDE.md"), own); await agentInit(root, true);
      const written = await readFile(join(root, "CLAUDE.md"), "utf8");
      expect(written.slice(0, written.indexOf("<!-- atdd-bun:start")), JSON.stringify(own)).toBe(own.endsWith("\n\n") ? own : own.replace(/\n?$/, "\n\n"));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("agent init retires only generator-owned delivery skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-delivery-skill-retirement-"));
  const generated = [".agents/skills/delivery/SKILL.md", ".claude/skills/delivery/review.md"];
  const authored = [".agents/skills/delivery/review.md", ".claude/skills/delivery/SKILL.md"];
  try {
    for (const path of [...generated, ...authored]) await mkdir(join(root, path, ".."), { recursive: true });
    for (const path of generated) await writeFile(join(root, path), "<!-- Generated by @afokapu/atdd-bun 0.10.0 -->\nretired\n");
    for (const path of authored) await writeFile(join(root, path), "# Our delivery guidance\n");
    expect((await agentStatus(root)).ok).toBeFalse();
    const result = await agentInit(root, true);
    expect(result.ok).toBeTrue();
    for (const path of generated) expect(await Bun.file(join(root, path)).exists()).toBeFalse();
    for (const path of authored) expect(await Bun.file(join(root, path)).text()).toBe("# Our delivery guidance\n");
    expect((await agentStatus(root)).ok).toBeTrue();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("repository bootstrap installs hooks, the CI workflow, and agent instructions without replacing unrelated workflows", async () => {
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
    for (const path of [".agents/skills/atdd/SKILL.md", ".claude/skills/atdd/SKILL.md"]) expect(await Bun.file(join(root, path)).exists()).toBeFalse();
    expect(await Bun.file(join(root, "AGENTS.md")).text()).toContain("atdd-bun:start");
    expect((await initializeRepository(root)).ok).toBeTrue();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release check is local, deterministic, and validates SemVer, intent, and reachable tags", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-release-")); const git = async (...args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); await child.exited; };
  try { await git("init", "-q"); await git("config", "user.email", "release@test"); await git("config", "user.name", "Release"); await writeFile(join(root, "package.json"), '{"version":"1.0.1"}\n'); await writeFile(join(root, "atdd-bun.yaml"), "release:\n  enabled: true\n  require_release_intent: true\n"); await mkdir(join(root, ".changeset")); await writeFile(join(root, ".changeset/decision.md"), "patch\n"); await git("add", "."); await git("commit", "-qm", "release"); await git("tag", "v1.0.0"); expect((await releaseCheck(root)).ok).toBeTrue(); await writeFile(join(root, "package.json"), '{"version":"broken"}\n'); expect((await releaseCheck(root)).ok).toBeFalse(); await writeFile(join(root, "package.json"), '{"version":"1.0.0"}\n'); expect((await releaseCheck(root)).ok).toBeFalse(); await writeFile(join(root, ".changeset/decision.md"), "invalid\n"); expect((await releaseCheck(root)).ok).toBeFalse(); } finally { await rm(root, { recursive: true, force: true }); }
});
