import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { boardUrl, DIRECTORY, localUrl, parseEnvelope, topicName } from "../src/board";
import { knownTopics, render } from "../src/board-ui";

// A stand-in for ntfy's publish and poll endpoints, enough for atdd-bun chat: messages per topic, in order, with ids.
type Stored = { id: string; time: number; topic: string; event: "message"; message: string };
const log: Stored[] = [];
let counter = 0;
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(req) {
    const url = new URL(req.url), [path, suffix] = url.pathname.slice(1).split("/");
    if (req.method === "POST") {
      const stored: Stored = { id: `m${String(++counter).padStart(6, "0")}`, time: Math.floor(Date.now() / 1000), topic: path, event: "message", message: await req.text() };
      log.push(stored);
      return Response.json(stored);
    }
    if (suffix === "json") {
      const topics = path.split(","), since = url.searchParams.get("since") ?? "all";
      const mine = log.filter(m => topics.includes(m.topic));
      const after = since === "all" ? -1 : log.findIndex(m => m.id === since);
      const out = since === "latest" ? mine.slice(-1) : log.filter((m, i) => i > after && topics.includes(m.topic));
      return new Response(out.map(m => JSON.stringify(m)).join("\n") + (out.length ? "\n" : ""));
    }
    return new Response("not found", { status: 404 });
  },
});
afterAll(() => server.stop(true));
const BOARD = `http://127.0.0.1:${server.port}`, cli = resolve(import.meta.dir, "../src/cli.ts");

// Agents run in a repository that enables the board; ATDD_BOARD_URL points it at the stand-in.
const enabled = await mkdtemp(join(tmpdir(), "atdd-board-on-"));
await writeFile(join(enabled, "atdd-bun.yaml"), "profiles: [delivery]\ndelivery:\n  board: {}\n");
afterAll(() => rm(enabled, { recursive: true, force: true }));
async function chat(env: Record<string, string>, args: string[], stdin = "", cwd = enabled) {
  const child = Bun.spawn({ cmd: ["bun", cli, "chat", ...args], cwd, env: { ...process.env, ATDD_BOARD_URL: BOARD, ...env }, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  return { code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() };
}
const as = (agent: string, ...topics: string[]) => ({ ATDD_AGENT: agent, ATDD_TOPICS: topics.join(",") });

test("topics are derived per level, reduced to ntfy's alphabet, and a long name keeps a hash of the whole", () => {
  expect(topicName("frg")).toBe("atdd-frg");
  expect(topicName("FRG", "Auth Flow")).toBe("atdd-frg-auth-flow");
  expect(topicName("frg", "auth", "final", 2)).toBe("atdd-frg-auth-final-2");
  const long = topicName("frg-workstation", "a very long tranche name that keeps going and going", "final", 12);
  expect(long.length).toBeLessThanOrEqual(64);
  expect(long).not.toBe(topicName("frg-workstation", "a very long tranche name that keeps going and going", "final", 13));
  expect(() => topicName("frg", "auth", "final")).toThrow("stage and round");
});

test("the board is local only: a public or malformed address is refused, from the environment or the config", async () => {
  expect(localUrl("http://127.0.0.1:2586/")).toBe("http://127.0.0.1:2586");
  expect(localUrl("http://localhost:9000")).toBe("http://localhost:9000");
  for (const url of ["https://ntfy.sh", "http://10.0.0.5:2586", "ntfy.sh/topic"]) expect(() => localUrl(url)).toThrow();
  const root = await mkdtemp(join(tmpdir(), "atdd-board-"));
  try {
    await writeFile(join(root, "atdd-bun.yaml"), "delivery:\n  board: { url: http://127.0.0.1:3999 }\n");
    expect(await boardUrl(root, {})).toBe("http://127.0.0.1:3999");
    expect(await boardUrl(root, { ATDD_BOARD_URL: "http://localhost:4000" })).toBe("http://localhost:4000");
    await writeFile(join(root, "atdd-bun.yaml"), "delivery:\n  board: { url: https://ntfy.sh }\n");
    expect(boardUrl(root, {})).rejects.toThrow("not local");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the board is opt-in: without delivery.board nothing is posted, even with ATDD_BOARD_URL set; topic names still work", async () => {
  const off = await mkdtemp(join(tmpdir(), "atdd-board-off-"));
  try {
    await writeFile(join(off, "atdd-bun.yaml"), "profiles: [delivery]\ndelivery:\n  root: docs/delivery/tranches\n");
    const topic = topicName("demo", "off"), before = log.length;
    const refused = await chat(as("driver@off", topic), ["post", topic, "--to", "writer@off"], "should not be posted", off);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("the board is not enabled; add delivery.board to atdd-bun.yaml");
    expect(log.length).toBe(before);
    expect((await chat({}, ["topic", "demo", "off"], "", off)).out.trim()).toBe(topic);
    await writeFile(join(off, "atdd-bun.yaml"), "profiles: [delivery]\n");
    expect(boardUrl(off, { ATDD_BOARD_URL: BOARD })).rejects.toThrow("not enabled");
    expect(await boardUrl(enabled, {})).toBe("http://127.0.0.1:2586");
  } finally { await rm(off, { recursive: true, force: true }); }
});

test("a message carries its header, reaches its recipient, and a reply is never missed however fast it comes", async () => {
  const tranche = topicName("demo", "auth");
  const posted = await chat(as("driver@auth", tranche), ["post", tranche, "--to", "writer-glm@auth", "--kind", "task", "--repo", "demo"], "Write greet.ts.");
  expect(posted.code).toBe(0);
  const task = await chat(as("writer-glm@auth", tranche), ["wait", tranche, "--timeout", "5"]);
  expect(task.out).toContain("driver@auth -> writer-glm@auth  (task)");
  expect(task.out).toContain("Write greet.ts.");
  // The reply is posted before the driver starts waiting from its own message: it is still found.
  await chat(as("writer-glm@auth", tranche), ["post", tranche, "--to", "driver@auth", "--kind", "result", "--reply-to", posted.out.trim()], "Done at abc123.");
  const result = await chat(as("driver@auth", tranche), ["wait", tranche, "--since", posted.out.trim(), "--timeout", "5"]);
  expect(result.out).toContain("Done at abc123.");
  const raw = log.find(m => m.message.includes("Done at abc123."))!.message;
  expect(raw).toContain('from: "writer-glm@auth"');
  expect(raw).toContain("to: [driver@auth]");
  expect(raw).toContain(`conversation: "${tranche}"`);
});

test("an agent uses only the topics it was launched with; a reviewer cannot read the tranche's conversation", async () => {
  const tranche = topicName("demo", "iso"), review = topicName("demo", "iso", "final", 1);
  await chat(as("driver@iso", tranche), ["post", tranche, "--to", "writer@iso"], "private tranche detail");
  const reviewer = as("reviewer-codex@iso", review);
  for (const args of [["read", tranche], ["wait", tranche, "--timeout", "1"]]) {
    const denied = await chat(reviewer, args);
    expect(denied.code).toBe(1);
    expect(denied.err).toContain("is not one of this agent's topics");
  }
  expect((await chat(reviewer, ["post", tranche, "--to", "driver@iso"], "sneaking in")).code).toBe(1);
  expect(log.some(m => m.message.includes("sneaking in"))).toBeFalse();
  // Without an identity, or without a recipient, nothing is posted.
  expect((await chat({ ATDD_TOPICS: review }, ["post", review, "--to", "driver@iso"], "anonymous")).err).toContain("ATDD_AGENT is not set");
  expect((await chat(reviewer, ["post", review], "to nobody")).err).toContain("--to is required");
});

test("wait is bounded: with nothing addressed to the agent it exits 2 and says how to continue", async () => {
  const review = topicName("demo", "quiet", "final", 1);
  await chat(as("driver@quiet", review), ["post", review, "--to", "someone-else"], "not for the reviewer");
  const waited = await chat(as("reviewer@quiet", review), ["wait", review, "--timeout", "1"]);
  expect(waited.code).toBe(2);
  expect(waited.err).toContain("wait again with --since");
});

test("the board lists its topics: each topic's first message names it once in the directory, and chat alone lists them", async () => {
  const program = topicName("view"), tranche = topicName("view", "t1"), review = topicName("view", "t1", "final", 1);
  const driver = as("driver@t1", program, tranche, review);
  for (const [topic, to] of [[program, "coordinator"], [tranche, "writer@t1"], [tranche, "writer@t1"], [review, "reviewer@t1"]] as const)
    expect((await chat(driver, ["post", topic, "--to", to], `to ${to}`)).code).toBe(0);
  expect(log.filter(m => m.topic === DIRECTORY && m.message === tranche)).toHaveLength(1);
  expect(await knownTopics(BOARD)).toEqual(expect.arrayContaining([program, tranche, review]));
  // Without a terminal, `atdd-bun chat` prints each topic with its message count; an agent sees only its own topics.
  const listed = await chat({}, []);
  expect(listed.out).toContain(`${tranche}  2`);
  expect(listed.out).toContain(`${review}  1`);
  const reviewerView = await chat(as("reviewer@t1", review), []);
  expect(reviewerView.out.trim().split("\n")).toEqual([`${review}  1`]);
});

test("the view nests topics program > tranche > review, highlights the selected one, and shows its conversation", () => {
  const message = (topic: string, id: string, text: string) => ({ id, time: 0, topic, raw: text, ...parseEnvelope(`---\nfrom: "driver@t1"\nto: [writer@t1]\n---\n${text}`) });
  const topics = ["atdd-p", "atdd-p-t1", "atdd-p-t1-final-1"];
  const lines = render({ topics, selected: 1, scroll: 0, url: "http://127.0.0.1:2586", messages: new Map([["atdd-p", []], ["atdd-p-t1", [message("atdd-p-t1", "a", "write greet.ts")]], ["atdd-p-t1-final-1", []]]) }, 100, 12);
  expect(lines[0]).toContain("3 topics");
  const panel = lines.slice(2).map(line => line.split(" │ ")[0]);
  expect(panel[0]).toStartWith("atdd-p ");
  expect(panel[1]).toContain("\x1b[7m  t1");
  expect(panel[2]).toStartWith("    final-1");
  expect(lines.join("\n")).toContain("driver@t1 -> writer@t1");
  expect(lines.join("\n")).toContain("write greet.ts");
  expect(lines.at(-1)).toContain("atdd-p-t1");
});
