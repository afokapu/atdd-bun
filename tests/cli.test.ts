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

test("ratchet classifies a topology finding carried when both exact worktrees emit the same repository-relative path", async () => {
  const repo = await mkdtemp(join(tmpdir(), "atdd-ratchet-root-path-"));
  await git(repo, "init", "-q", "-b", "main"); await git(repo, "config", "user.email", "ratchet@test"); await git(repo, "config", "user.name", "Ratchet");
  await writeFile(join(repo, "atdd-bun.yaml"), "profiles: [topology]\nratchet: { mode: reject-new, profiles: [topology] }\n");
  await mkdir(join(repo, "plan"));
  await writeFile(join(repo, "plan", "wrong.yaml"), "urn: wagon:orders\nwmbt:\n  total: 0\nfeatures: []\n");
  await git(repo, "add", "."); await git(repo, "commit", "-qm", "base topology debt");
  const base = await git(repo, "rev-parse", "HEAD");
  await writeFile(join(repo, "candidate.md"), "same finding, distinct candidate worktree\n"); await git(repo, "add", "."); await git(repo, "commit", "-qm", "candidate");
  const result = await run("topology", "--root", repo, "--ratchet", "--base", base);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ mode: "reject-new", carried: [expect.any(String)], new: [], resolved: [] });
}, 20_000);

test("ordinary direct-profile ratchet keeps comparing the explicitly selected profile despite configured profiles", async () => {
  const repo = await mkdtemp(join(tmpdir(), "atdd-ratchet-direct-profile-"));
  await git(repo, "init", "-q", "-b", "main"); await git(repo, "config", "user.email", "ratchet@test"); await git(repo, "config", "user.name", "Ratchet");
  await writeFile(join(repo, "atdd-bun.yaml"), "profiles: [flow]\nratchet: { mode: report, profiles: [coder] }\n");
  await git(repo, "add", "."); await git(repo, "commit", "-qm", "base");
  const base = await git(repo, "rev-parse", "HEAD");
  await writeFile(join(repo, "candidate.ts"), "export const value = 1;\n"); await git(repo, "add", "."); await git(repo, "commit", "-qm", "candidate");
  const result = await run("coder", "--root", repo, "--ratchet", "--base", base);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ mode: "report", profiles: ["coder"], resolved: [] });
}, 20_000);

test("explicit profile activation carries legacy findings while judging both exact trees under the expanded profiles", async () => {
  const repo = await mkdtemp(join(tmpdir(), "atdd-ratchet-activation-"));
  await git(repo, "init", "-q", "-b", "main"); await git(repo, "config", "user.email", "ratchet@test"); await git(repo, "config", "user.name", "Ratchet");
  await writeFile(join(repo, "atdd-bun.yaml"), "profiles: [flow]\n");
  await mkdir(join(repo, "plan"));
  await Bun.write(join(repo, "plan", "orders.yaml"), "urn: wmbt:orders:E001\nacceptances:\n  - identity: { urn: acc:orders:E001-UNIT-001 }\n");
  await git(repo, "add", "."); await git(repo, "commit", "-qm", "partial base with debt");
  const base = await git(repo, "rev-parse", "HEAD");
  await writeFile(join(repo, "atdd-bun.yaml"), "profiles: [flow, traceability]\nratchet: { mode: reject-new, profiles: [flow, traceability] }\n");
  await git(repo, "commit", "-am", "explicit full profile activation", "-q");
  const result = await run("--profile", "flow,traceability", "--root", repo, "--ratchet", "--ratchet-activate-profiles", "--base", base);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ mode: "reject-new", profiles: ["flow", "traceability"], carried: [expect.any(String)], new: [], resolved: [] });
});

test("profile activation rejects removal, unrelated policy edits, and an absent explicit activation flag", async () => {
  const setup = async (baseConfig: string, candidateConfig: string) => {
    const repo = await mkdtemp(join(tmpdir(), "atdd-ratchet-activation-invalid-"));
    await git(repo, "init", "-q", "-b", "main"); await git(repo, "config", "user.email", "ratchet@test"); await git(repo, "config", "user.name", "Ratchet");
    await writeFile(join(repo, "atdd-bun.yaml"), baseConfig); await git(repo, "add", "."); await git(repo, "commit", "-qm", "base");
    const base = await git(repo, "rev-parse", "HEAD");
    await writeFile(join(repo, "atdd-bun.yaml"), candidateConfig); await git(repo, "commit", "-am", "candidate", "-q");
    return { repo, base };
  };
  const removal = await setup("profiles: [flow, traceability]\n", "profiles: [flow]\nratchet: { mode: reject-new, profiles: [flow] }\n");
  const removed = await run("flow", "--root", removal.repo, "--ratchet", "--ratchet-activate-profiles", "--base", removal.base);
  expect(removed.exitCode).toBe(1); expect(removed.stderr).toContain("explicit monotonic profile expansion");
  const context = await setup("profiles: [flow]\ntopology: { plan_root: plan }\n", "profiles: [flow, traceability]\nratchet: { mode: reject-new, profiles: [flow, traceability] }\ntopology: { plan_root: contracts }\n");
  const changed = await run("--profile", "flow,traceability", "--root", context.repo, "--ratchet", "--ratchet-activate-profiles", "--base", context.base);
  expect(changed.exitCode).toBe(1); expect(changed.stderr).toContain("identical non-profile context");
  const implicit = await setup("profiles: [flow]\n", "profiles: [flow, traceability]\nratchet: { mode: reject-new, profiles: [flow, traceability] }\n");
  const absent = await run("--profile", "flow,traceability", "--root", implicit.repo, "--ratchet", "--base", implicit.base);
  expect(absent.exitCode).toBe(1); expect(absent.stderr).toContain("profile/context differ");
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
  const result = await run("flow", "--root", repo, "--ratchet", "--ratchet-activate-profiles", "--base", base);
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
  const result = await run("flow", "--root", repo, "--ratchet", "--ratchet-activate-profiles", "--base", unrelated);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("ancestor of candidate HEAD");
});

const allProfiles = "[traceability, topology, docs, planner, telemetry, coder, tester, security, architecture, metrics, runtime, interlocking, htmx, design, flow]";
const debt = (id: string) => `urn: wmbt:orders:${id}\nacceptances:\n  - identity: { urn: acc:orders:${id}-UNIT-001 }\n`;
/** A base with no atdd-bun.yaml selects the implicit default profiles, exactly as the generated commit gate reads it. */
const implicitBase = async (candidate: Record<string, string>, baseFiles: Record<string, string> = {}) => {
  const repo = await mkdtemp(join(tmpdir(), "atdd-ratchet-implicit-base-"));
  await git(repo, "init", "-q", "-b", "main"); await git(repo, "config", "user.email", "ratchet@test"); await git(repo, "config", "user.name", "Ratchet");
  await mkdir(join(repo, "plan"));
  for (const [path, content] of Object.entries({ "plan/carried.yaml": debt("E001"), "plan/resolved.yaml": debt("E002"), ...baseFiles })) await Bun.write(join(repo, path), content);
  await git(repo, "add", "-A"); await git(repo, "commit", "-qm", "implicit default base with debt");
  const base = await git(repo, "rev-parse", "HEAD");
  for (const [path, content] of Object.entries(candidate)) await Bun.write(join(repo, path), content);
  await git(repo, "add", "-A"); await git(repo, "commit", "-qm", "explicit candidate", "--allow-empty");
  return { repo, base };
};
const activate = (repo: string, base: string, ...selection: string[]) => run(...(selection.length ? selection : ["all"]), "--root", repo, "--ratchet", "--ratchet-activate-profiles", "--base", base);
const explicitAll = `profiles: ${allProfiles}\nratchet: { mode: reject-new, profiles: ${allProfiles} }\n`;

test("profile activation accepts an implicit-default base expanding to the explicit full profile set with carried and resolved evidence", async () => {
  const { repo, base } = await implicitBase({ "atdd-bun.yaml": explicitAll });
  await git(repo, "rm", "-q", "plan/resolved.yaml"); await git(repo, "commit", "-qm", "resolve debt");
  const result = await activate(repo, base);
  expect(result.stderr).not.toContain("explicit monotonic profile expansion");
  expect(result.exitCode).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({ mode: "reject-new", base, new: [] });
  expect(report.profiles).toHaveLength(15);
  expect(report.carried.some((key: string) => key.includes("plan/carried.yaml"))).toBe(true);
  expect(report.resolved.some((key: string) => key.includes("plan/resolved.yaml"))).toBe(true);
}, 60_000);

test("profile activation from an implicit-default base still rejects new findings", async () => {
  const { repo, base } = await implicitBase({ "atdd-bun.yaml": explicitAll, "plan/new.yaml": debt("E003") });
  const result = await activate(repo, base);
  expect(result.exitCode).toBe(1);
  const report = JSON.parse(result.stdout);
  expect(report.new.some((key: string) => key.includes("plan/new.yaml"))).toBe(true);
}, 60_000);

test("profile activation from an implicit-default base preserves every fail-closed negative", async () => {
  const unavailable = await implicitBase({ "atdd-bun.yaml": explicitAll });
  const missing = await activate(unavailable.repo, "0".repeat(40));
  expect(missing.exitCode).toBe(1); expect(missing.stderr).toContain("unavailable or not a full exact commit");

  const defaults = "[traceability, topology, docs, planner, telemetry, coder, tester, security, architecture, metrics, runtime, interlocking, htmx, design]";
  const implicitCandidate = await implicitBase({ "atdd-bun.yaml": `ratchet: { mode: reject-new, profiles: ${defaults} }\n` });
  const noExplicit = await activate(implicitCandidate.repo, implicitCandidate.base);
  expect(noExplicit.exitCode).toBe(1); expect(noExplicit.stderr).toContain("explicitly configured candidate profile set");

  const mismatch = await implicitBase({ "atdd-bun.yaml": `profiles: ${allProfiles}\nratchet: { mode: reject-new, profiles: [flow] }\n` });
  const policyMismatch = await activate(mismatch.repo, mismatch.base);
  expect(policyMismatch.exitCode).toBe(1); expect(policyMismatch.stderr).toContain("ratchet.profiles must exactly equal");

  const shrink = await implicitBase({ "atdd-bun.yaml": "profiles: [traceability, flow]\nratchet: { mode: reject-new, profiles: [traceability, flow] }\n" });
  const shrinking = await activate(shrink.repo, shrink.base);
  expect(shrinking.exitCode).toBe(1); expect(shrinking.stderr).toContain("explicit monotonic profile expansion");

  const same = await implicitBase({ "atdd-bun.yaml": `profiles: ${defaults}\nratchet: { mode: reject-new, profiles: ${defaults} }\n` });
  const unchanged = await activate(same.repo, same.base);
  expect(unchanged.exitCode).toBe(1); expect(unchanged.stderr).toContain("explicit monotonic profile expansion");

  const drift = await implicitBase({ "atdd-bun.yaml": `${explicitAll}topology: { plan_root: contracts }\n` });
  const drifted = await activate(drift.repo, drift.base);
  expect(drifted.exitCode).toBe(1); expect(drifted.stderr).toContain("identical non-profile context");

  const configured = await implicitBase({ "atdd-bun.yaml": `${explicitAll}topology: { plan_root: contracts }\n` }, { "atdd-bun.yaml": "topology: { plan_root: plan }\n" });
  const configuredDrift = await activate(configured.repo, configured.base);
  expect(configuredDrift.exitCode).toBe(1); expect(configuredDrift.stderr).toContain("identical non-profile context");

  const dirty = await implicitBase({ "atdd-bun.yaml": explicitAll });
  await writeFile(join(dirty.repo, "untracked.txt"), "not committed\n");
  const dirtied = await activate(dirty.repo, dirty.base);
  expect(dirtied.exitCode).toBe(1); expect(dirtied.stderr).toContain("porcelain-clean");

  const unknown = await implicitBase({ "atdd-bun.yaml": `profiles: [traceability, nope]\nratchet: { mode: reject-new, profiles: [traceability, nope] }\n` });
  const unknownProfile = await activate(unknown.repo, unknown.base);
  expect(unknownProfile.exitCode).toBe(1); expect(unknownProfile.stdout).toBe("");
  const duplicate = await implicitBase({ "atdd-bun.yaml": `profiles: [flow, ${allProfiles.slice(1)}\nratchet: { mode: reject-new, profiles: ${allProfiles} }\n` });
  const duplicated = await activate(duplicate.repo, duplicate.base);
  expect(duplicated.exitCode).toBe(1); expect(duplicated.stdout).toBe(""); expect(duplicated.stderr).toContain("explicitly configured candidate profile set");
  const legacy = await implicitBase({ "atdd-bun.yaml": `profiles: ${allProfiles.replace("flow", "workflow")}\nratchet: { mode: reject-new, profiles: ${allProfiles} }\n` });
  const legacied = await activate(legacy.repo, legacy.base);
  expect(legacied.exitCode).toBe(1); expect(legacied.stdout).toBe(""); expect(legacied.stderr).toContain("explicitly configured candidate profile set");
}, 120_000);
