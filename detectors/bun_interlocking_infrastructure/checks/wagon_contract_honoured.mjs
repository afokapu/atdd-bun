#!/usr/bin/env bun
// Member check: coder.bun.wagon-honours-its-contract  (interlocking infrastructure family)
//
// A wagon's plan document declares a DATA CONTRACT — `produce[]` are the artifacts it
// owns and `consume[]` the ones it takes from other wagons (core's wagon.schema.json
// requires both). The implementation must actually move those artifacts through Cargo.
//
// Nothing checked that. A wagon declaring `produce: [{name: orders:confirmed-order}]`
// and `consume: [{name: orders:priced-basket}]` whose code mentions neither passed
// every gated rule in this workspace. The declaration and the code were free to drift
// apart, which is the same class as a runtime that transcribes its route space instead
// of executing it.
//
// Core owns the SHAPE — wagon.schema.json validates that produce/consume exist and are
// well formed, wherever the plan lives. It cannot know whether a Bun module puts those
// artifacts into Cargo, because that means reading Bun source and this stack's Cargo
// idiom. Shape is core's; binding is this extension's.
//
// NOT_APPLICABLE, deliberately, when the consumer declares no wagon contract, or when
// no wagon implementation exists at all. A plan with no wagons has nothing to honour,
// and a declared-but-unwritten wagon is an unimplemented feature, not a broken
// contract — reporting it here would fire on every freshly planned repo.
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations to
// ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const RULE = "coder.bun.wagon-honours-its-contract";
const EXCLUDES = ["node_modules", "dist", "build", ".next", ".git", "_generated"];
const TS = /\.(ts|tsx|mjs|js)$/;
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
const PLAN_ROOT = process.env.ATDD_PLAN_ROOT || "plan";

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

function parseJsonEnv(name, fallback) {
  try { const v = JSON.parse(process.env[name] || ""); return Array.isArray(v) ? v : fallback; }
  catch { return fallback; }
}

function walk(dir, pred, excludes) {
  const out = [];
  (function rec(d) {
    let entries;
    try { entries = readdirSync(d).sort(); } catch { return; }
    for (const n of entries) {
      if (excludes.includes(n)) continue;
      const full = join(d, n);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) rec(full);
      else if (pred(full)) out.push(full);
    }
  })(dir);
  return out;
}

function consumerRoots(root, excludes) {
  const roots = [];
  (function rec(d) {
    let st;
    try { st = statSync(d); } catch { return; }
    if (!st.isDirectory()) return;
    try { if (statSync(join(d, PLAN_ROOT)).isDirectory()) { roots.push(d); return; } } catch {}
    let entries;
    try { entries = readdirSync(d).sort(); } catch { return; }
    for (const n of entries) if (!excludes.includes(n)) rec(join(d, n));
  })(root);
  return roots;
}

// Artifact names under `produce:` / `consume:` in a wagon document. Read line-wise
// rather than with a YAML parser so this check carries no dependency the rest of the
// family does not already have; the shape it reads is the one core's schema requires.
export function wagonContract(text) {
  if (!/^wagon:\s*\S/m.test(text)) return null;
  const out = { produce: [], consume: [] };
  let section = null;
  for (const line of text.split(/\r?\n/)) {
    const top = line.match(/^(\w+):\s*$/);
    if (top) { section = top[1] === "produce" || top[1] === "consume" ? top[1] : null; continue; }
    if (/^\S/.test(line)) { section = null; continue; }
    if (!section) continue;
    const name = line.match(/^\s*-?\s*name:\s*["']?([^"'#\s]+)["']?/);
    if (name) out[section].push(name[1]);
  }
  return out.produce.length || out.consume.length ? out : null;
}

// Blank out COMMENTS, keeping string literals intact.
//
// The artifact name legitimately appears as a literal — `cargo.put("orders:confirmed-order")`
// — so the usual mask-literals-and-comments helper cannot be used here; it would erase the
// very evidence this rule looks for. Comments alone are masked, because a wagon must not be
// able to honour its contract by MENTIONING the artifact in prose. Caught by a dirty fixture
// whose explanatory comment named both artifacts and silenced the rule.
export function maskComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function closingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function handlerBody(text, name) {
  const escaped = escape(name);
  const forms = [
    new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*\\([^)]*\\)\\s*(?::[^={]+)?\\{`),
    new RegExp(`\\b(?:export\\s+)?(?:const|let)\\s+${escaped}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{`),
  ];
  for (const form of forms) {
    const match = form.exec(text);
    if (!match) continue;
    const open = match.index + match[0].lastIndexOf("{");
    const close = closingBrace(text, open);
    if (close >= 0) return text.slice(open + 1, close);
  }
  return "";
}

function localConstants(text) {
  const values = new Map();
  const re = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(text)) !== null) values.set(match[1], match[2]);
  return values;
}

function artifactArgument(argument, constants) {
  const literal = /^\s*["']([^"']+)["']\s*$/.exec(argument);
  if (literal) return literal[1];
  const identifier = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(argument);
  return identifier ? constants.get(identifier[1]) ?? null : null;
}

function cargoMoves(handler, module) {
  const constants = localConstants(module), reads = new Set(), writes = new Set();
  for (const [method, target] of [["get", reads], ["put", writes]]) {
    const re = new RegExp(`\\bcargo\\s*\\.\\s*${method}\\s*\\(\\s*([^,)]*)`, "g");
    let match;
    while ((match = re.exec(handler)) !== null) {
      const artifact = artifactArgument(match[1], constants);
      if (artifact) target.add(artifact);
    }
  }
  return { reads, writes };
}

function importedHandlers(runner) {
  const handlers = [];
  const re = /^\s*import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/gm;
  let match;
  while ((match = re.exec(runner.text)) !== null) {
    if (!match[2].startsWith(".")) continue;
    const target = resolve(dirname(runner.file), match[2]);
    const file = [target, `${target}.ts`, `${target}.tsx`, join(target, "index.ts")]
      .find((candidate) => runner.sources.has(candidate));
    if (!file) continue;
    for (const entry of match[1].split(",")) {
      const [imported, local = imported] = entry.trim().split(/\s+as\s+/);
      if (imported && local && imported !== "Cargo") handlers.push({ name: local.trim(), file });
    }
  }
  return handlers;
}

function executedHandlers(wagon, runners, sources) {
  const handlers = [];
  const wagonLiteral = escape(wagon);
  for (const runner of runners) {
    const imports = importedHandlers({ ...runner, sources });
    for (const handler of imports) {
      const branch = new RegExp(
        `\\b(?:if\\s*\\(\\s*step\\s*={2,3}\\s*["']${wagonLiteral}["']\\s*\\)|case\\s*["']${wagonLiteral}["']\\s*:)` +
        `[\\s\\S]{0,240}?\\b${escape(handler.name)}\\s*\\(\\s*cargo\\b`,
      );
      if (branch.test(runner.text)) handlers.push(handler);
    }
  }
  return handlers;
}

const reportPath = process.env.ATDD_VIOLATIONS_REPORT;
if (!reportPath) {
  process.stderr.write("bun-infra: ATDD_VIOLATIONS_REPORT not set\n");
  process.exit(2);
}
const excludes = [...EXCLUDES, ...parseJsonEnv("ATDD_SCAN_EXCLUDES", [])];
const violations = [];

for (const root of parseJsonEnv("ATDD_SCAN_ROOTS", [])) {
  for (const croot of consumerRoots(root, excludes)) {
    // Only a wagon some train carries moves Cargo, so only its contract can be honoured or broken in Cargo-moving code.
    // A wagon no train's sequence carries yet (implemented, composed in a later tranche) is not judged until one does
    // (S4 #qSWeDfXJVXcv; the convention's exception is per wagon, not per repository).
    const contracts = [], carried = new Set();
    for (const f of walk(join(croot, PLAN_ROOT), (p) => /\.ya?ml$/.test(p), excludes)) {
      const text = read(f), c = wagonContract(text);
      if (c) contracts.push({ file: f, wagon: text.match(/^wagon:\s*["']?([^"'#\s]+)/m)?.[1] ?? null, ...c });
      let doc;
      try { doc = Bun.YAML.parse(text); } catch { continue; }
      if (doc && typeof doc.train_id === "string" && Array.isArray(doc.sequence))
        for (const step of doc.sequence) for (const end of [step?.from, step?.to]) if (typeof end === "string" && end.startsWith("wagon:")) carried.add(end.slice(6).trim());
    }
    if (!contracts.length) continue;                     // no declared contract

    const sources = walk(croot, (p) => TS.test(p) && !TEST.test(p), excludes)
      .map((file) => ({ file, text: maskComments(read(file)) }));
    // Do not turn a plan-only repository into a contract failure. Once this consumer
    // does have Cargo-shaped source, however, each carried wagon must bind its own
    // handler into the train path; a global source blob is not evidence of that.
    if (!sources.some((s) => /\bCargo\b|\bcargo\s*\.\s*(?:put|get)\s*\(/.test(s.text))) continue;
    const sourceByFile = new Map(sources.map((source) => [source.file, source.text]));
    const trainRoot = join(croot, "src", "trains") + sep;
    const runners = sources.filter((source) => source.file.startsWith(trainRoot));
    for (const c of contracts) {
      if (c.wagon && !carried.has(c.wagon)) continue;   // no train carries this wagon yet
      const handlers = c.wagon ? executedHandlers(c.wagon, runners, sourceByFile) : [];
      const reads = new Set(), writes = new Set();
      for (const handler of handlers) {
        const module = sourceByFile.get(handler.file) ?? "";
        const body = handlerBody(module, handler.name);
        const moves = cargoMoves(body, module);
        for (const artifact of moves.reads) reads.add(artifact);
        for (const artifact of moves.writes) writes.add(artifact);
      }
      for (const [kind, names] of [["produce", c.produce], ["consume", c.consume]]) {
        for (const name of names) {
          const moved = kind === "produce" ? writes : reads;
          if (moved.has(name)) continue;
          const rel = c.file.startsWith(croot + sep) ? c.file.slice(croot.length + 1) : c.file;
          violations.push({
            rule_id: RULE, file: rel, line: 1, col: 0,
            evidence:
              `the wagon declares it ${kind === "produce" ? "produces" : "consumes"} ` +
              `"${name}", but no handler reachable from that wagon's train step ` +
              `${kind === "produce" ? "writes" : "reads"} it through Cargo; artifact constants ` +
              `or unrelated Cargo code do not honour the wagon contract`,
            source_line: "",
          });
        }
      }
    }
  }
}
writeFileSync(reportPath, JSON.stringify({ violations }, null, 2), "utf8");
process.stderr.write(`bun-infra[wagon-contract]: ${violations.length} violation(s)\n`);
process.exit(0);
