import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

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

test("help exposes the command inventory and failures route users to it", async () => {
  const help = await run("help", "--json");
  expect(help.exitCode).toBe(0);
  expect(JSON.parse(help.stdout).profiles).toContain("planner");
  const unknown = await run("not-a-profile");
  expect(unknown.exitCode).toBe(1);
  expect(unknown.stderr).toContain("atdd-bun help");
});
