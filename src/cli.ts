#!/usr/bin/env bun
import { enforce, profileNames, type Profile } from "./enforce";
import { finishWorktree, hookEvents, hooksStatus, installHooks, runHook, startWorktree, uninstallHooks, worktreeStatus } from "./hooks";
import { ciInit, ciStatus } from "./ci";
import { agentInit, agentStatus } from "./agent";
import { checkIntegrity, formatIntegrity, integrityInit, integrityStatus } from "./integrity";
import { journeyDocs } from "./journey-docs";
import { formatPlannedDebt, loadLifecycle, plannedDebt } from "./lifecycle";
import { gate } from "./adoption";
import { releaseCheck } from "./release";
import { initializeRepository } from "./setup";

const args = process.argv.slice(2);
const usage = {
  command: "atdd-bun",
  usage: [
    "atdd-bun [profile ...] [--root <path>]",
    "atdd-bun gate [--base <ref>] [--root <path>]",
    "atdd-bun init [--replace]",
    "atdd-bun hooks <install|uninstall|status> [--replace]",
    "atdd-bun worktree <start|finish|status>",
    "atdd-bun ci <init|status> [--replace]",
    "atdd-bun agent <init|status> [--replace]",
    "atdd-bun integrity [init|status] [--replace]",
    "atdd-bun docs journeys [--out <dir>] [--check] [--force]",
    "atdd-bun lifecycle [--json] [--root <path>]",
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
if (args[0] === "docs") {
  if (args[1] !== "journeys") fail("docs requires journeys");
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
if (args[0] === "gate") {
  const flag = (name: string) => { const at = args.indexOf(name); if (at === -1) return undefined; if (!args[at + 1]) fail(`${name} requires a value`); return args[at + 1]; };
  const result = await gate({ root: flag("--root"), base: flag("--base") });
  for (const violation of result.blocking) console.error([violation.file, violation.line, violation.col].join(":") + " " + violation.rule_id + " — " + violation.evidence);
  console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "lifecycle") {
  const at = args.indexOf("--root"), where = at === -1 ? process.cwd() : args[at + 1];
  if (at !== -1 && !where) fail("--root requires a path");
  const debt = plannedDebt(await loadLifecycle(where));
  console.log(args.includes("--json") ? JSON.stringify(debt, null, 2) : formatPlannedDebt(debt)); process.exit(0);
}
if (args[0] === "release") {
  if (args[1] !== "check") fail("release requires check");
  const result = await releaseCheck(); console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}

const valueAfter = (flag: string) => args[args.indexOf(flag) + 1];
const root = args.includes("--root") ? valueAfter("--root") : process.cwd();
if (args.includes("--root") && !root) fail("--root requires a path");
const positional: string[] = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--root" || arg === "--profile") { index += 1; continue; }
  if (!arg.startsWith("-")) positional.push(arg);
}
const profileValue = args.includes("--profile") ? valueAfter("--profile") : undefined;
if (args.includes("--profile") && !profileValue) fail("--profile requires one or more comma-separated profiles");
const requested = profileValue ? profileValue.split(",").filter(Boolean) : positional.length ? positional : ["all"];
const invalid = requested.find(profile => !profileNames.includes(profile as Profile));
if (invalid) fail("unknown command or profile: " + invalid);
const violations = await enforce({ root, profiles: requested as Profile[] });
for (const violation of violations) {
  console.error([violation.file, violation.line, violation.col].join(":") + " " + violation.rule_id + " — " + violation.evidence);
}
if (violations.length) console.error("\nUse the rule ID and evidence above to correct the affected artifact. Run atdd-bun help for commands and profiles.");
process.exitCode = violations.length ? 1 : 0;
