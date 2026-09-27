import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The delivery board: a local ntfy server the coordinator, drivers, writers and reviewers talk through
 * (the delivery.board convention). One topic per level (program, tranche, review conversation); every message
 * carries a header naming its sender, recipients and subject. The board is where the work is visible; the
 * evidence record stays the only thing the delivery rules judge. */

export const DEFAULT_BOARD_URL = "http://127.0.0.1:2586";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const TOPIC_LIMIT = 64;

/** The board is opt-in: on only when atdd-bun.yaml names delivery.board. Its URL is $ATDD_BOARD_URL, else
 * delivery.board.url, else the default; the environment moves the board on one machine but never switches it on. Only a
 * local address is accepted, so a wrong setting can never send a message to a public server. */
export async function boardUrl(root = process.cwd(), env: Record<string, string | undefined> = process.env): Promise<string> {
  let board: unknown;
  const file = join(root, "atdd-bun.yaml");
  if (existsSync(file)) try { board = (Bun.YAML.parse(await readFile(file, "utf8")) as { delivery?: { board?: unknown } } | null)?.delivery?.board; } catch { /* reported by delivery.config-schema */ }
  if (!board || typeof board !== "object" || Array.isArray(board)) throw new Error("the board is not enabled; add delivery.board to atdd-bun.yaml (for example board: { url: http://127.0.0.1:2586 }) to have agents talk through it");
  const configured = (board as { url?: unknown }).url;
  return localUrl(env.ATDD_BOARD_URL || (typeof configured === "string" ? configured : DEFAULT_BOARD_URL));
}

export function localUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`board URL ${raw} is not a URL`); }
  if (!/^https?:$/.test(url.protocol) || !LOCAL_HOSTS.has(url.hostname)) throw new Error(`board URL ${raw} is not local; the board runs on this machine (127.0.0.1, localhost or [::1])`);
  return `${url.protocol}//${url.host}`;
}

/** A topic name derived from its level: atdd-<program>[-<tranche>[-<stage>-<round>]]. Parts are lowercased and
 * reduced to [a-z0-9-]; a name longer than ntfy's 64 characters keeps its start and a hash of the whole. */
export function topicName(program: string, tranche?: string, stage?: string, round?: string | number): string {
  const parts = [program, tranche, stage, round === undefined ? undefined : String(round)].filter((part): part is string => part !== undefined && part !== "");
  if (!parts.length) throw new Error("a topic needs at least the program name");
  if (stage !== undefined && round === undefined) throw new Error("a review conversation topic needs its stage and round");
  const slug = (part: string) => part.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const name = ["atdd", ...parts.map(slug)].join("-");
  if (name.length <= TOPIC_LIMIT) return name;
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return `${name.slice(0, TOPIC_LIMIT - 9).replace(/-+$/, "")}-${hash}`;
}

/** Topics this agent may use, from $ATDD_TOPICS (comma-separated), given by whoever launched it. */
export function allowedTopics(env: Record<string, string | undefined> = process.env): string[] {
  return (env.ATDD_TOPICS ?? "").split(",").map(topic => topic.trim()).filter(Boolean);
}

export function checkTopic(topic: string, env: Record<string, string | undefined> = process.env): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) throw new Error(`${topic} is not a topic name; derive one with atdd-bun chat topic`);
  const allowed = allowedTopics(env);
  if (!allowed.includes(topic)) throw new Error(`${topic} is not one of this agent's topics (ATDD_TOPICS: ${allowed.join(", ") || "none"}); an agent reads and writes only the topics it was launched with`);
}

export const HEADER_FIELDS = ["kind", "stage", "reply-to", "repo", "branch", "worktree", "goal", "base", "sha"] as const;
export type Header = { from: string; to: string[]; participants: string[]; conversation: string } & Partial<Record<(typeof HEADER_FIELDS)[number], string>>;
export type Message = { id: string; time: number; topic: string; header: Partial<Header>; body: string; raw: string };

export function envelope(header: Header, body: string): string {
  const value = (v: string | string[]) => Array.isArray(v) ? `[${v.join(", ")}]` : JSON.stringify(v);
  return `---\n${Object.entries(header).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${value(v as string | string[])}`).join("\n")}\n---\n${body.trim()}`;
}

export function parseEnvelope(text: string): { header: Partial<Header>; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { header: {}, body: text };
  try { return { header: (Bun.YAML.parse(match[1]) ?? {}) as Partial<Header>, body: match[2] }; } catch { return { header: {}, body: text }; }
}

const addressedTo = (message: Message, agent: string) => [message.header.to ?? []].flat().includes(agent);

/** Posts with a few retries (a busy or restarting board), then fails loudly: a message is never silently lost. */
export async function post(url: string, topic: string, header: Header, body: string): Promise<string> {
  let error = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${url}/${topic}`, { method: "POST", body: envelope(header, body), headers: { Title: `${header.from} -> ${header.to.join(", ")}` } });
      if (res.ok) return (await res.json() as { id: string }).id;
      error = `${res.status} ${await res.text()}`;
    } catch (e) { error = String(e); }
    await Bun.sleep(250 * 2 ** attempt);
  }
  throw new Error(`post to ${topic} failed: ${error}`);
}

/** Every message on the topics after `since` (a message id, or "all"). */
export async function read(url: string, topics: string[], since = "all"): Promise<Message[]> {
  const res = await fetch(`${url}/${topics.join(",")}/json?poll=1&since=${since}`);
  if (!res.ok) throw new Error(`reading ${topics.join(", ")} failed: ${res.status} ${await res.text()}`);
  return (await res.text()).split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(m => m.event === "message")
    .map(m => ({ id: m.id, time: m.time, topic: m.topic, raw: m.message, ...parseEnvelope(m.message) }));
}

/** Waits for the next message addressed to `agent` after `since`. It polls rather than streams: a live stream can drop
 * a message published while it connects. Returns null after `timeoutSeconds`, so an agent's tool call stays bounded. */
export async function waitFor(url: string, topic: string, agent: string, since = "all", timeoutSeconds = 0, intervalMs = 500): Promise<Message | null> {
  const deadline = timeoutSeconds > 0 ? Date.now() + timeoutSeconds * 1000 : Infinity;
  for (;;) {
    let messages: Message[] = [];
    try { messages = await read(url, [topic], since); } catch { /* the board is briefly unavailable: keep waiting */ }
    for (const message of messages) { since = message.id; if (addressedTo(message, agent)) return message; }
    if (Date.now() >= deadline) return null;
    await Bun.sleep(intervalMs);
  }
}

export function format(message: Message, withTopic = false): string {
  const time = new Date(message.time * 1000).toTimeString().slice(0, 8), h = message.header;
  const route = `${h.from ?? "?"} -> ${[h.to ?? []].flat().join(", ") || "?"}`, tags = [h.kind, h.stage].filter(Boolean).join(" · ");
  return `${withTopic ? `[${message.topic}] ` : ""}${time}  ${route}${tags ? `  (${tags})` : ""}  #${message.id}\n${message.body.trim()}\n`;
}

/** `atdd-bun chat <topic|post|read|wait|show> …`. Returns the exit code: 0 done, 1 error, 2 wait timed out. */
export async function chat(args: string[], env: Record<string, string | undefined> = process.env, root = process.cwd()): Promise<number> {
  const [command, ...rest] = args;
  const flag = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
  const list = (value?: string) => (value ?? "").split(",").map(item => item.trim()).filter(Boolean);
  const positional = rest.filter((arg, i) => !arg.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--") && !["--mine", "--once"].includes(rest[i - 1])));
  const agent = () => { if (!env.ATDD_AGENT) throw new Error("ATDD_AGENT is not set: every agent is launched with its identity"); return env.ATDD_AGENT; };
  try {
    if (command === "topic") { console.log(topicName(positional[0], positional[1], positional[2], positional[3])); return 0; }
    const url = await boardUrl(root, env), topics = list(positional[0]);
    if (!topics.length) throw new Error(`usage: atdd-bun chat ${command ?? "<post|read|wait|show>"} <topic> …`);
    if (command === "show") {
      // A human's view; an agent sees only its own topics.
      if (env.ATDD_AGENT) topics.forEach(topic => checkTopic(topic, env));
      let since = "all";
      for (;;) {
        const messages = await read(url, topics, since).catch(() => []);
        for (const message of messages) { since = message.id; console.log(format(message, topics.length > 1)); }
        if (rest.includes("--once")) return 0;
        await Bun.sleep(1000);
      }
    }
    if (topics.length !== 1) throw new Error(`${command} takes one topic`);
    const topic = topics[0], me = agent();
    checkTopic(topic, env);
    if (command === "post") {
      const to = list(flag("to"));
      if (!to.length) throw new Error("--to is required: every message names its recipients");
      const body = await new Response(Bun.stdin.stream()).text();
      if (!body.trim()) throw new Error("the message body is read from standard input and is empty");
      const header: Header = { from: me, to, participants: [...new Set([me, ...to, ...list(flag("participants"))])], conversation: topic };
      for (const field of HEADER_FIELDS) if (flag(field)) header[field] = flag(field);
      console.log(await post(url, topic, header, body));
      return 0;
    }
    if (command === "read") {
      for (const message of await read(url, [topic], flag("since") ?? "all")) if (!rest.includes("--mine") || addressedTo(message, me)) console.log(format(message));
      return 0;
    }
    if (command === "wait") {
      const message = await waitFor(url, topic, me, flag("since") ?? "all", Number(flag("timeout") ?? 0));
      if (!message) { console.error(`no message for ${me} on ${topic} yet; wait again with --since to continue`); return 2; }
      console.log(format(message));
      return 0;
    }
    throw new Error(`unknown chat command ${command}; use topic, post, read, wait or show`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
