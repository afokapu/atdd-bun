import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkInstalledPackage, checkIntegrity, formatIntegrity, loosenedPolicy, writeManifest } from "../src/integrity";
import { initializeRepository } from "../src/setup";

const packageRoot = resolve(import.meta.dir, "..");
const git = async (root: string, ...args: string[]) => { const child = Bun.spawn({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }); await child.exited; };
const lockEntry = '    "@afokapu/atdd-bun": ["@afokapu/atdd-bun@0.2.0", "", { "bin": { "atdd-bun": "src/cli.ts" } }, "sha512-abc=="],\n';

/** A consumer repository bootstrapped by `init`, installing the package from npm. */
async function consumer() {
  const root = await mkdtemp(join(tmpdir(), "atdd-integrity-"));
  await git(root, "init", "-q", "-b", "feature"); await git(root, "config", "user.email", "i@test"); await git(root, "config", "user.name", "I");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "app", devDependencies: { "@afokapu/atdd-bun": "^0.2.0" } }, null, 2));
  await writeFile(join(root, "bun.lock"), `{\n  "packages": {\n${lockEntry}  }\n}\n`);
  expect((await initializeRepository(root)).ok).toBeTrue();
  return root;
}
const files = (findings: { file: string }[]) => findings.map(f => f.file).sort();

test("a freshly bootstrapped consumer is canonical", async () => {
  const root = await consumer();
  try { expect(await checkIntegrity({ root })).toEqual([]); } finally { await rm(root, { recursive: true, force: true }); }
});

test("edited generated files, a non-npm dependency, and a missing test are each reported with the way back", async () => {
  const root = await consumer();
  try {
    const workflow = join(root, ".github/workflows/atdd-bun.yml");
    await writeFile(workflow, (await readFile(workflow, "utf8")).replace("bun run atdd-bun integrity", "true"));
    await writeFile(join(root, ".claude/skills/atdd/SKILL.md"), "---\nname: atdd\ndescription: anything goes\n---\n");
    await writeFile(join(root, "AGENTS.md"), (await readFile(join(root, "AGENTS.md"), "utf8")).replace("Never modify", "Feel free to modify"));
    await writeFile(join(root, "CLAUDE.md"), "# rules\n");
    await rm(join(root, "atdd-bun.integrity.test.ts"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "app", devDependencies: { "@afokapu/atdd-bun": "github:someone/atdd-bun" } }));
    await writeFile(join(root, "bun.lock"), '{\n  "packages": {\n    "@afokapu/atdd-bun": ["@afokapu/atdd-bun@github:someone/atdd-bun#abc", {}, "someone-atdd-bun-abc"],\n  }\n}\n');
    const findings = await checkIntegrity({ root });
    expect(files(findings)).toEqual([".claude/skills/atdd/SKILL.md", ".github/workflows/atdd-bun.yml", "AGENTS.md", "CLAUDE.md", "atdd-bun.integrity.test.ts", "bun.lock", "package.json"]);
    const message = formatIntegrity(findings);
    for (const text of ["ATDD INTEGRITY VIOLATION", "You are not allowed to edit them", "stop and ask the human", "restore: bun run atdd-bun ci init --replace", "CI runs this same check on a clean install"]) expect(message).toContain(text);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an upgrade's new version stamp is not tampering, and the test follows bunfig's test root", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-integrity-root-"));
  try {
    await git(root, "init", "-q");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "app", devDependencies: { "@afokapu/atdd-bun": "^0.2.0" } }));
    await writeFile(join(root, "bun.lock"), `{\n  "packages": {\n${lockEntry}  }\n}\n`);
    await writeFile(join(root, "bunfig.toml"), '[install]\nexact = true\n\n[test]\nroot = "tests"\n');
    expect((await initializeRepository(root)).ok).toBeTrue();
    expect(await Bun.file(join(root, "tests/atdd-bun.integrity.test.ts")).exists()).toBeTrue();
    const skill = join(root, ".agents/skills/atdd/SKILL.md");
    await writeFile(skill, (await readFile(skill, "utf8")).replace(/@afokapu\/atdd-bun \d+\.\d+\.\d+/, "@afokapu/atdd-bun 9.9.9"));
    expect(await checkIntegrity({ root })).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("loosening atdd-bun.yaml against the base branch is reported; tightening is not", async () => {
  const root = await consumer();
  try {
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_changed_lines: 300\n");
    await git(root, "add", "-A"); await git(root, "commit", "-qm", "base", "--no-verify"); await git(root, "branch", "base");
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_changed_lines: 200\n");
    expect(await checkIntegrity({ root, base: "base", push: false })).toEqual([]);
    await writeFile(join(root, "atdd-bun.yaml"), "max_staged_changed_lines: 5000\nrequire_traceability: false\nprotected_branches: [develop]\n");
    const [finding] = await checkIntegrity({ root, base: "base", push: false });
    expect(finding.file).toBe("atdd-bun.yaml");
    for (const text of ["max_staged_changed_lines 300 → 5000", "require_traceability true → false", "protected_branches drops main, master"]) expect(finding.detail).toContain(text);
    await git(root, "checkout", "-q", "base"); await git(root, "add", "-A"); await git(root, "commit", "-qm", "loosen on main", "--no-verify");
    expect(files(await checkIntegrity({ root, base: "base", push: true }))).toEqual(["atdd-bun.yaml"]);
    expect(loosenedPolicy({}, { registry_paths: ["plan/_*.yaml", "src/**"] } as never)).toEqual(["registry_paths adds src/**"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
