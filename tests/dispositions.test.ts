import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// atdd-bun fails on every finding: it has no advisory mode and no ratchet baseline. A rule
// that has a live validator must therefore say so, `strict` or `block`, never a disposition
// that promises it will not fail.
const root = resolve(import.meta.dir, "..");
const ENFORCING = new Set(["strict", "block"]);
type Convention = { rule_id?: string; metadata?: { disposition?: string }; implementation?: { type?: string; ref?: string } };

async function conventions(dir: string): Promise<Array<{ file: string; text: string; data: Convention }>> {
  const out: Array<{ file: string; text: string; data: Convention }> = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await conventions(path));
    else if (entry.name.endsWith(".convention.yaml")) { const text = await readFile(path, "utf8"); out.push({ file: path.slice(root.length + 1), text, data: Bun.YAML.parse(text) as Convention }); }
  }
  return out;
}

test("every shipped convention names its validator and is strict or block", async () => {
  const weak = (await conventions(join(root, "conventions"))).filter(({ data }) => data.implementation?.type !== "validator" || !data.implementation.ref || !ENFORCING.has(data.metadata?.disposition ?? "")).map(({ file, data }) => `${file}: ${data.implementation?.type ?? "no implementation"} / ${data.metadata?.disposition ?? "no disposition"}`);
  expect(weak).toEqual([]);
});

test("every planner rule this package enforces is declared strict or block in ENFORCEMENT_SCOPE", async () => {
  // The canonical nodes are shipped verbatim, so the package states its own enforcement in the scope file.
  const scope = Bun.YAML.parse(await readFile(join(root, "planner-nodes/ENFORCEMENT_SCOPE.yaml"), "utf8")) as { canonical_bun_enforcement: Array<{ rule_id: string; disposition?: string }> };
  const weak = scope.canonical_bun_enforcement.filter(item => !ENFORCING.has(item.disposition ?? "")).map(item => `${item.rule_id}: ${item.disposition ?? "no disposition"}`);
  expect(weak).toEqual([]);
});

test("no convention promises a ratchet or advisory treatment the package does not have", async () => {
  const note = "# strict: atdd-bun fails on every finding; it has no advisory mode and no ratchet baseline.";
  const promises = (await conventions(join(root, "conventions"))).flatMap(({ file, text }) => text.split("\n").map((line, i) => ({ file, line: i + 1, text: line.trim() })))
    .filter(l => /ratchet|suppress-and-clean|documentation-only/i.test(l.text) && l.text !== note).map(l => `${l.file}:${l.line} ${l.text}`);
  expect(promises).toEqual([]);
});

test("every convention's prose is text: no statement, term or exception was parsed as a YAML map", async () => {
  // An unquoted `: ` inside a list item turns a sentence into a map and silently truncates it.
  const malformed = (await conventions(join(root, "conventions"))).flatMap(({ file, data }) => {
    const d = data as Convention & { statement?: unknown; terms?: Array<{ text?: unknown }>; content?: { exceptions?: unknown[] } };
    return [["statement", d.statement], ...(d.terms ?? []).map(t => ["term", t.text]), ...(d.content?.exceptions ?? []).map(e => ["exception", e])]
      .filter(([, value]) => value !== undefined && typeof value !== "string").map(([kind, value]) => `${file}: ${kind} ${JSON.stringify(value).slice(0, 80)}`);
  });
  expect(malformed).toEqual([]);
});
