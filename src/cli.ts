#!/usr/bin/env bun
import { enforce, type Profile } from "./enforce";
import { finishWorktree, hookEvents, hooksStatus, installHooks, runHook, startWorktree, uninstallHooks, worktreeStatus } from "./hooks";
import { ciInit, ciStatus } from "./ci";
import { releaseCheck } from "./release";

const args = process.argv.slice(2);
if (args[0] === "hooks") {
  const result = args[1] === "install" ? await installHooks(process.cwd(), args.includes("--replace")) : args[1] === "uninstall" ? await uninstallHooks() : await hooksStatus();
  console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "hook" && hookEvents.includes(args[1] as any)) {
  const result = await runHook(args[1] as any, process.cwd(), args.slice(2), await new Response(Bun.stdin.stream()).text());
  if (result.message) console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "worktree") {
  const result = args[1] === "start" ? await startWorktree(process.cwd(), args[2] ?? "") : args[1] === "finish" ? await finishWorktree(process.cwd(), args.includes("--delete-branch")) : await worktreeStatus(process.cwd());
  console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1);
}
if (args[0] === "ci") { const result = args[1] === "init" ? await ciInit(process.cwd(), args.includes("--replace")) : await ciStatus(); console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1); }
if (args[0] === "release" && args[1] === "check") { const result = await releaseCheck(); console[result.ok ? "log" : "error"](result.message); process.exit(result.ok ? 0 : 1); }
const valueAfter = (flag: string) => args[args.indexOf(flag) + 1];
const root = args.includes("--root") ? valueAfter("--root") : process.cwd();
const profileValue = args.includes("--profile") ? valueAfter("--profile") : "all";
const profiles = profileValue.split(",").filter(Boolean) as Profile[];

const violations = await enforce({ root, profiles });
for (const violation of violations) {
  console.error(`${violation.file}:${violation.line}:${violation.col} ${violation.rule_id} — ${violation.evidence}`);
}
process.exitCode = violations.length ? 1 : 0;
