#!/usr/bin/env bun
import { enforce, enabledProfiles, flowCompatibilityDiagnostic, normalizeProfileName, profileNames, type Profile } from "./enforce";
import { compareFindings, contextDigest, parseRatchetPolicy } from "./ratchet";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { finishWorktree, hookEvents, hooksStatus, installHooks, runHook, startWorktree, uninstallHooks, worktreeStatus } from "./hooks";
import { ciInit, ciStatus } from "./ci";
import { agentInit, agentStatus } from "./agent";
import { checkIntegrity, formatIntegrity, integrityInit, integrityStatus } from "./integrity";
import { journeyDocs } from "./journey-docs";
import { adrRegister } from "./docs-capability";
import { releaseCheck } from "./release";
import { initializeRepository } from "./setup";
import { profileRegistries } from "./profile-registry";

const args = process.argv.slice(2);
const usage = {
  command: "atdd-bun",
  usage: [
    "atdd-bun [profile ...] [--root <path>] [--ratchet --base <full-sha>]", 
    "atdd-bun init [--replace]",
    "atdd-bun hooks <install|uninstall|status> [--replace]",
    "atdd-bun worktree <start|finish|status>",
    "atdd-bun ci <init|status> [--replace]",
    "atdd-bun agent <init|status> [--replace]",
    "atdd-bun profiles registry [--check]",
    "atdd-bun integrity [init|status] [--replace]",
    "atdd-bun docs journeys [--out <dir>] [--check] [--force]",
    "atdd-bun docs adr-register [--check]",
    "atdd-bun release check",
  ],
  profiles: profileNames,
  note: "Use a profile directly, for example: atdd-bun planner. --profile planner remains supported for compatibility.",
};

function printHelp(): void {
  if (args.includes("--json")) { console.log(JSON.stringify(usage, null, 2)); return; }
  console.log([
    "ATdd Bun enforcement",
    "",
    "Usage:",
    ...usage.usage.map(line => "  " + line),
    "",
    "Profiles: " + profileNames.join(", "),
    "",
    usage.note,
  ].join("\n"));
}

function fail(message: string): never {
  console.error([message, "Run atdd-bun help for available commands and profiles."].join("\n"));
  process.exit(1);
}

if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
  printHelp();
  process.exit(0);
}
if (args[0] === "hooks") {
  const result = args[1] === "install" ? await installHooks(process.cwd(), args.includes("--replace")) : args[1] === "uninstall" ? await uninstallHooks() : args[1] === "status" ? await hooksStatus() : fail("hooks requires install, uninstall, or status");
  console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "init") {
  const result = await initializeRepository(process.cwd(), args.includes("--replace"));
  console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "hook") {
  if (!hookEvents.includes(args[1] as typeof hookEvents[number])) fail("unknown hook event: " + (args[1] ?? "(missing)"));
  const result = await runHook(args[1] as typeof hookEvents[number], process.cwd(), args.slice(2), await new Response(Bun.stdin.stream()).text());
  if (result.message) console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "worktree") {
  const result = args[1] === "start" ? await startWorktree(process.cwd(), args[2] ?? "") : args[1] === "finish" ? await finishWorktree(process.cwd(), args.includes("--delete-branch")) : args[1] === "status" ? await worktreeStatus(process.cwd()) : fail("worktree requires start, finish, or status");
  console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "ci") {
  const result = args[1] === "init" ? await ciInit(process.cwd(), args.includes("--replace")) : args[1] === "status" ? await ciStatus() : fail("ci requires init or status");
  console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "docs" && args[1] === "adr-register") {
  const result = await adrRegister(process.cwd(), args.includes("--check"));
  console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "docs") {
  if (args[1] !== "journeys") fail("docs requires journeys or adr-register");
  const at = args.indexOf("--out"), out = at === -1 ? undefined : args[at + 1];
  if (at !== -1 && !out) fail("--out requires a directory");
  const result = await journeyDocs({ out, check: args.includes("--check"), force: args.includes("--force") });
  console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "integrity") {
  if (args[1] === "init" || args[1] === "status") { const result = args[1] === "init" ? await integrityInit(process.cwd(), args.includes("--replace")) : await integrityStatus(); console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1); }
  if (args[1] !== undefined) fail("integrity takes no argument, or init/status");
  const findings = await checkIntegrity();
  if (findings.length) { console.error(formatIntegrity(findings)); process.exit(1); }
  console.log("atdd-bun integrity: canonical"); process.exit(0);
}
if (args[0] === "agent") {
  const result = args[1] === "init" ? await agentInit(process.cwd(), args.includes("--replace")) : args[1] === "status" ? await agentStatus() : fail("agent requires init or status");
  console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "profiles") {
  if (args[1] !== "registry") fail("profiles requires registry");
  const result = await profileRegistries({ check: args.includes("--check") });
  console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "release") {
  if (args[1] !== "check") fail("release requires check");
  const result = await releaseCheck(); console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}

const valueAfter = (flag: string) => args[args.indexOf(flag) + 1];
const root = args.includes("--root") ? valueAfter("--root") : process.cwd();
if (args.includes("--root") && !root) fail("--root requires a path");
if (args.includes("--base") && !valueAfter("--base")) fail("--base requires a full commit SHA");
const positional: string[] = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--root" || arg === "--profile" || arg === "--base") { index += 1; continue; }
  if (!arg.startsWith("-")) positional.push(arg);
}
const profileValue = args.includes("--profile") ? valueAfter("--profile") : undefined;
if (args.includes("--profile") && !profileValue) fail("--profile requires one or more comma-separated profiles");
const requested = profileValue ? profileValue.split(",").filter(Boolean) : positional.length ? positional : ["all"];
const normalizedRequested = requested.map(normalizeProfileName);
const invalid = normalizedRequested.find(profile => !profileNames.includes(profile as Profile));
if (invalid) fail("unknown command or profile: " + invalid);
if (requested.includes("workflow")) console.error(flowCompatibilityDiagnostic);
const printViolations = (violations: Awaited<ReturnType<typeof enforce>>) => {
  for (const violation of violations) console.error([violation.file, violation.line, violation.col].join(":") + " " + violation.rule_id + " — " + violation.evidence);
};
const configAt = async (directory: string) => {
  const file = join(directory, "atdd-bun.yaml");
  return existsSync(file) ? Bun.YAML.parse(await readFile(file, "utf8")) as Record<string, unknown> : {};
};
const git = async (directory: string, gitArgs: string[]) => {
  const child = Bun.spawn({ cmd: ["git", ...gitArgs], cwd: directory, stdout: "pipe", stderr: "pipe" });
  return { code: await child.exited, out: (await new Response(child.stdout).text()).trim(), err: (await new Response(child.stderr).text()).trim() };
};
const stable = (items: string[]) => [...new Set(items)].sort();
if (!args.includes("--ratchet")) {
  const violations = await enforce({ root, profiles: normalizedRequested as Profile[] });
  printViolations(violations);
  if (violations.length) console.error("\nUse the rule ID and evidence above to correct the affected artifact. Run atdd-bun help for commands and profiles.");
  process.exitCode = violations.length ? 1 : 0;
} else {
  const base = valueAfter("--base");
  if (!base || !/^[0-9a-f]{40}$/i.test(base)) fail("--ratchet requires --base <full-40-character-sha>");
  const candidateRoot = resolve(root), candidateConfig = await configAt(candidateRoot), policy = parseRatchetPolicy(candidateConfig);
  if (!policy) fail("--ratchet requires an explicit atdd-bun.yaml ratchet policy");
  const candidateProfiles = normalizedRequested.includes("all") ? await enabledProfiles(candidateRoot) : normalizedRequested;
  if (stable(policy.profiles).join(",") !== stable(candidateProfiles).join(",")) fail("ratchet.profiles must exactly equal the selected profiles");
  if ((await git(candidateRoot, ["diff", "--quiet"])).code !== 0) fail("--ratchet requires a clean candidate worktree");
  const resolved = await git(candidateRoot, ["rev-parse", "--verify", `${base}^{commit}`]);
  if (resolved.code || resolved.out.toLowerCase() !== base.toLowerCase()) fail(`ratchet base ${base} is unavailable or not a full exact commit`);
  const scratch = await mkdtemp(join(tmpdir(), "atdd-ratchet-"));
  try {
    const added = await git(candidateRoot, ["worktree", "add", "--detach", "--no-checkout", scratch, base]);
    if (added.code) fail(`could not materialize ratchet base: ${added.err || added.out}`);
    const checkedOut = await git(scratch, ["checkout", "--detach", base]);
    if (checkedOut.code) fail(`could not checkout ratchet base: ${checkedOut.err || checkedOut.out}`);
    const baseConfig = await configAt(scratch), baseProfiles = normalizedRequested.includes("all") ? await enabledProfiles(scratch) : normalizedRequested;
    if (stable(baseProfiles).join(",") !== stable(candidateProfiles).join(",") || contextDigest(baseConfig, baseProfiles) !== contextDigest(candidateConfig, candidateProfiles)) fail("ratchet base and candidate profile/context differ; use a separately governed adoption path");
    const [baseFindings, candidateFindings] = await Promise.all([enforce({ root: scratch, profiles: candidateProfiles as Profile[] }), enforce({ root: candidateRoot, profiles: candidateProfiles as Profile[] })]);
    const normalize = (findings: Awaited<ReturnType<typeof enforce>>, directory: string) => findings.map(finding => ({ ...finding, file: relative(directory, finding.file).replaceAll("\\", "/") }));
    const delta = compareFindings(normalize(baseFindings, scratch), normalize(candidateFindings, candidateRoot));
    console.log(JSON.stringify({ schema: "atdd-bun.ratchet-report/v1", mode: policy.mode, base, candidate: (await git(candidateRoot, ["rev-parse", "HEAD"])).out, profiles: stable(candidateProfiles), context: contextDigest(candidateConfig, candidateProfiles), ...delta }, null, 2));
    if (policy.mode === "reject-new" && delta.new.length) process.exitCode = 1;
  } finally {
    await git(candidateRoot, ["worktree", "remove", "--force", scratch]);
    await rm(scratch, { recursive: true, force: true });
  }
}
