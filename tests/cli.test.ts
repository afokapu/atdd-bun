import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dir, "..");
const cli = join(root, "src/cli.ts");
const fixture = join(root, "detectors/planner_schema_validation/fixtures/clean");

async function run(...args: string[]) {
  const child = Bun.spawn({ cmd: [Bun.which("bun") ?? globalThis.process.execPath, cli, ...args], cwd: root, stdout: "pipe", stderr: "pipe" });
  return { exitCode: await child.exited, stdout: await new Response(child.stdout).text(), stderr: await new Response(child.stderr).text() };
}

test("profiles are direct CLI selectors and the compatibility flag still works", async () => {
  expect((await run("planner", "--root", fixture)).exitCode).toBe(0);
  expect((await run("--profile", "planner", "--root", fixture)).exitCode).toBe(0);
});

test("legacy workflow CLI selection normalizes to flow and gives local-upgrade guidance", async () => {
  const canonical = await run("flow", "--root", fixture);
  const legacy = await run("workflow", "--root", fixture);
  expect(legacy.exitCode).toBe(canonical.exitCode);
  expect(legacy.stdout).toBe(canonical.stdout);
  expect(legacy.stderr).toContain("canonical flow");
  expect(legacy.stderr).toContain("older than 0.10.45");
  expect(legacy.stderr).toContain("bun run atdd-bun flow --root .");
});

test("help exposes the command inventory and failures route users to it", async () => {
  const help = await run("help", "--json");
  expect(help.exitCode).toBe(0);
  expect(JSON.parse(help.stdout).profiles).toContain("planner");
  const unknown = await run("not-a-profile");
  expect(unknown.exitCode).toBe(1);
  expect(unknown.stderr).toContain("atdd-bun help");
});

test("profile registry generation can be checked through the CLI", async () => {
  const result = await run("profiles", "registry", "--check");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("profile registries are current");
});

const git = async (cwd: string, ...args: string[]) => {
  const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(child.stdout).text();
  await child.exited;
  return out.trim();
};

test("ratchet refuses an exact base when finding-affecting context differs", async () => {
  const repo = await mkdtemp(join(tmpdir(), "atdd-ratchet-cli-"));
  await git(repo, "init", "-q", "-b", "main"); await git(repo, "config", "user.email", "ratchet@test"); await git(repo, "config", "user.name", "Ratchet");
  await writeFile(join(repo, "atdd-bun.yaml"), "profiles: [flow]\nratchet: { mode: report, profiles: [flow] }\ntopology: { plan_root: plan }\n");
  await git(repo, "add", "."); await git(repo, "commit", "-qm", "base");
  const base = await git(repo, "rev-parse", "HEAD");
  await writeFile(join(repo, "atdd-bun.yaml"), "profiles: [flow]\nratchet: { mode: report, profiles: [flow] }\ntopology: { plan_root: contracts }\n");
  await git(repo, "commit", "-am", "different context", "-q");
  const result = await run("flow", "--root", repo, "--ratchet", "--base", base);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("profile/context differ");
});

test("ratchet reject-new fails only candidate findings and emits a delta report", async () => {
  const repo = await mkdtemp(join(tmpdir(), "atdd-ratchet-delta-"));
  await git(repo, "init", "-q", "-b", "main"); await git(repo, "config", "user.email", "ratchet@test"); await git(repo, "config", "user.name", "Ratchet");
  await writeFile(join(repo, "atdd-bun.yaml"), "profiles: [traceability]\nratchet: { mode: reject-new, profiles: [traceability] }\n");
  await git(repo, "add", "."); await git(repo, "commit", "-qm", "base");
  const base = await git(repo, "rev-parse", "HEAD");
  await mkdir(join(repo, "plan"));
  await Bun.write(join(repo, "plan", "orders.yaml"), "urn: wmbt:orders:E001\nacceptances:\n  - identity: { urn: acc:orders:E001-UNIT-001 }\n");
  await git(repo, "add", "."); await git(repo, "commit", "-qm", "candidate finding");
  const result = await run("traceability", "--root", repo, "--ratchet", "--base", base);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ mode: "reject-new", new: [expect.any(String)], carried: [], resolved: [] });
});

test("ratchet refuses staged or untracked candidate state", async () => {
  const repo = await mkdtemp(join(tmpdir(), "atdd-ratchet-dirty-"));
  await git(repo, "init", "-q", "-b", "main"); await git(repo, "config", "user.email", "ratchet@test"); await git(repo, "config", "user.name", "Ratchet");
  await writeFile(join(repo, "atdd-bun.yaml"), "profiles: [flow]\nratchet: { mode: report, profiles: [flow] }\n");
  await git(repo, "add", "."); await git(repo, "commit", "-qm", "base");
  const base = await git(repo, "rev-parse", "HEAD");
  await writeFile(join(repo, "staged.txt"), "not committed\n"); await git(repo, "add", "staged.txt");
  const result = await run("flow", "--root", repo, "--ratchet", "--base", base);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("porcelain-clean");
});

test("ratchet refuses a base outside candidate history", async () => {
  const repo = await mkdtemp(join(tmpdir(), "atdd-ratchet-ancestry-"));
  await git(repo, "init", "-q", "-b", "main"); await git(repo, "config", "user.email", "ratchet@test"); await git(repo, "config", "user.name", "Ratchet");
  await writeFile(join(repo, "atdd-bun.yaml"), "profiles: [flow]\nratchet: { mode: report, profiles: [flow] }\n");
  await git(repo, "add", "."); await git(repo, "commit", "-qm", "root");
  await git(repo, "checkout", "-qb", "side"); await writeFile(join(repo, "side.txt"), "side\n"); await git(repo, "add", "."); await git(repo, "commit", "-qm", "side");
  const unrelated = await git(repo, "rev-parse", "HEAD");
  await git(repo, "checkout", "-q", "main"); await writeFile(join(repo, "candidate.txt"), "candidate\n"); await git(repo, "add", "."); await git(repo, "commit", "-qm", "candidate");
  const result = await run("flow", "--root", repo, "--ratchet", "--base", unrelated);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("ancestor of candidate HEAD");
});
