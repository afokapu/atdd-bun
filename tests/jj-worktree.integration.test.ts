import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finishWorktree, startWorktree, worktreeStatus } from "../src/hooks";

const roots: string[] = [];

async function exec(cwd: string, command: string, ...args: string[]) {
  const child = Bun.spawn([command, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`);
  return stdout.trim();
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

test("JJ integration: Bun creates, observes, and safely retires a colocated workspace", async () => {
  if (!Bun.which("jj")) return;
  const root = await mkdtemp(join(tmpdir(), "atdd-bun-jj-"));
  roots.push(root);
  const repository = join(root, "repository"), worktrees = join(root, "worktrees");
  await mkdir(repository);
  await exec(repository, "git", "init", "--initial-branch=main");
  await exec(repository, "git", "config", "user.email", "fixture@example.test");
  await exec(repository, "git", "config", "user.name", "Fixture");
  await writeFile(join(repository, "README.md"), "initial\n");
  await writeFile(join(repository, "atdd-bun.yaml"), `worktrees:
  enabled: true
  root: ${worktrees}
  primary_directory: .
  primary_branch: main
  require_linked_worktree: true
`);
  await exec(repository, "git", "add", ".");
  await exec(repository, "git", "commit", "-m", "initial");
  await exec(repository, "jj", "git", "init", "--colocate");

  const started = await startWorktree(repository, "delivery/demo", "jj");
  expect(started.ok, started.message).toBe(true);
  const child = join(worktrees, "delivery-demo");
  expect(await exec(child, "jj", "workspace", "root")).toBe(child);
  expect((await worktreeStatus(child, "jj")).message).toContain("delivery-demo");

  await writeFile(join(child, "feature.txt"), "jj rewrite\n");
  await exec(child, "jj", "status");
  const current = await exec(child, "jj", "log", "-r", "@", "--no-graph", "-T", "commit_id");
  expect(await exec(child, "git", "rev-parse", "refs/heads/delivery/demo")).toBe(current);

  await exec(repository, "jj", "bookmark", "set", "main", "-r", "delivery/demo");
  expect(await exec(repository, "git", "rev-parse", "refs/heads/main")).toBe(current);

  const finished = await finishWorktree(child, true, "jj");
  expect(finished.ok, finished.message).toBe(true);
  expect(await Bun.file(child).exists()).toBe(false);
  const deleted = Bun.spawn(["git", "show-ref", "--verify", "--quiet", "refs/heads/delivery/demo"], { cwd: repository });
  expect(await deleted.exited).not.toBe(0);
});
