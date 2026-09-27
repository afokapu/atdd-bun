import { allowedTopics, DIRECTORY, format, read, type Message } from "./board";

/** `atdd-bun chat` alone: a terminal view of the board, every topic in a panel on the left and the selected topic's
 * conversation on the right, refreshed every second. ntfy cannot list its topics, so the board keeps a directory
 * topic (atdd-topics) that atdd-bun chat post fills with each topic's name on its first message. */

/** Every topic the directory names, in order. */
export async function knownTopics(url: string): Promise<string[]> {
  const entries = await read(url, [DIRECTORY]).catch(() => [] as Message[]);
  return [...new Set(entries.map(entry => entry.raw.trim()).filter(topic => /^[A-Za-z0-9_-]{1,64}$/.test(topic)))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

export type UiState = { topics: string[]; messages: Map<string, Message[]>; selected: number; scroll: number; url: string };

/** A topic's parent is the longest other topic it extends (atdd-p-t3-final-1 under atdd-p-t3 under atdd-p). */
function tree(topics: string[]): Array<{ topic: string; depth: number; label: string }> {
  return topics.map(topic => {
    const ancestors = topics.filter(other => other !== topic && topic.startsWith(`${other}-`));
    const parent = ancestors.sort((a, b) => b.length - a.length)[0];
    return { topic, depth: ancestors.length, label: parent ? topic.slice(parent.length + 1) : topic };
  });
}

const fit = (text: string, width: number) => text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width);
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (!line) { out.push(""); continue; }
    for (let i = 0; i < line.length; i += width) out.push(line.slice(i, i + width));
  }
  return out;
}

/** The screen as lines, without escape codes except the selection's inverse video: pure, so it can be tested. */
export function render(state: UiState, width: number, height: number): string[] {
  const left = Math.max(20, Math.min(40, Math.floor(width / 3))), right = Math.max(10, width - left - 3), rows = Math.max(1, height - 2);
  const nodes = tree(state.topics), selected = nodes[state.selected]?.topic;
  const panel = nodes.map((node, i) => {
    const count = String(state.messages.get(node.topic)?.length ?? 0);
    const text = `${"  ".repeat(node.depth)}${node.label}`;
    const cell = `${fit(text, left - count.length - 1)} ${count}`;
    return i === state.selected ? `\x1b[7m${cell}\x1b[0m` : cell;
  });
  if (!panel.length) panel.push(fit("no topics yet", left));
  const body = selected ? (state.messages.get(selected) ?? []).flatMap(message => wrap(format(message), right)) : wrap("Nothing posted yet. Topics appear here as agents post to them.", right);
  const end = Math.max(0, body.length - state.scroll), start = Math.max(0, end - rows), view = body.slice(start, end);
  const first = Math.max(0, Math.min(state.selected - Math.floor(rows / 2), panel.length - rows));
  const header = fit(` Delivery board  ${state.url}  ·  ${state.topics.length} topics  ·  ↑↓ topic  PgUp/PgDn scroll  q quit`, width);
  const lines = [header, `${"─".repeat(left)}─┬─${"─".repeat(right)}`];
  for (let row = 0; row < rows - 1; row++) lines.push(`${panel[first + row] ?? " ".repeat(left)} │ ${fit(view[row] ?? "", right)}`);
  lines.push(fit(selected ? ` ${selected}${state.scroll ? `  (scrolled up ${state.scroll})` : ""}` : "", width));
  return lines;
}

/** Runs the view until q. Without a terminal it prints the topic list and exits. */
export async function runUi(url: string, env: Record<string, string | undefined> = process.env): Promise<number> {
  const visible = async () => { const all = await knownTopics(url); return env.ATDD_AGENT ? all.filter(topic => allowedTopics(env).includes(topic)) : all; };
  const state: UiState = { topics: [], messages: new Map(), selected: 0, scroll: 0, url };
  const refresh = async () => {
    state.topics = await visible();
    for (const topic of state.topics) {
      const known = state.messages.get(topic) ?? [], since = known.at(-1)?.id ?? "all";
      const fresh = await read(url, [topic], since).catch(() => [] as Message[]);
      if (fresh.length || !state.messages.has(topic)) state.messages.set(topic, [...known, ...fresh]);
    }
  };
  await refresh();
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    for (const topic of state.topics) console.log(`${topic}  ${state.messages.get(topic)?.length ?? 0}`);
    return 0;
  }
  const draw = () => process.stdout.write(`\x1b[H\x1b[2J${render(state, process.stdout.columns || 100, process.stdout.rows || 30).join("\n")}`);
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  process.stdin.setRawMode(true); process.stdin.resume();
  let done: (code: number) => void = () => {};
  const finished = new Promise<number>(resolve => { done = resolve; });
  const quit = () => { clearInterval(timer); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\x1b[?25h\x1b[?1049l"); done(0); };
  process.stdin.on("data", (data: Buffer) => {
    const key = data.toString();
    if (key === "q" || key === "\x03") return quit();
    if (key === "\x1b[A" || key === "k") { state.selected = Math.max(0, state.selected - 1); state.scroll = 0; }
    if (key === "\x1b[B" || key === "j") { state.selected = Math.min(state.topics.length - 1, state.selected + 1); state.scroll = 0; }
    if (key === "\x1b[5~") state.scroll += 10;
    if (key === "\x1b[6~") state.scroll = Math.max(0, state.scroll - 10);
    draw();
  });
  process.stdout.on("resize", draw);
  const timer = setInterval(async () => { await refresh(); draw(); }, 1000);
  draw();
  return finished;
}
