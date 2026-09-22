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
import { join, sep } from "node:path";

const RULE = "coder.bun.wagon-honours-its-contract";
const EXCLUDES = ["node_modules", "dist", "build", ".next", ".git", "_generated"];
const TS = /\.(ts|tsx|mjs|js)$/;
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

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
    try { if (statSync(join(d, "plan")).isDirectory()) { roots.push(d); return; } } catch {}
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

const reportPath = process.env.ATDD_VIOLATIONS_REPORT;
if (!reportPath) {
  process.stderr.write("bun-infra: ATDD_VIOLATIONS_REPORT not set\n");
  process.exit(2);
}
const excludes = [...EXCLUDES, ...parseJsonEnv("ATDD_SCAN_EXCLUDES", [])];
const violations = [];

for (const root of parseJsonEnv("ATDD_SCAN_ROOTS", [])) {
  for (const croot of consumerRoots(root, excludes)) {
    const contracts = [];
    for (const f of walk(join(croot, "plan"), (p) => /\.ya?ml$/.test(p), excludes)) {
      const c = wagonContract(read(f));
      if (c) contracts.push({ file: f, ...c });
    }
    if (!contracts.length) continue;                     // no declared contract

    const sources = walk(croot, (p) => TS.test(p) && !TEST.test(p), excludes)
      .map((f) => ({ file: f, text: read(f) }));
    // A wagon implementation is one that moves artifacts through Cargo. Detected by
    // that behaviour rather than by filename — a `wagon.ts` naming heuristic is the
    // kind of fitted check this hub has had to unpick more than once.
    const wagonCode = sources.filter((s) => /\bCargo\b|\bcargo\s*\.\s*(?:put|get)\s*\(/.test(s.text));
    if (!wagonCode.length) continue;                     // nothing implemented to judge

    const blob = wagonCode.map((s) => maskComments(s.text)).join("\n");
    for (const c of contracts) {
      for (const [kind, names] of [["produce", c.produce], ["consume", c.consume]]) {
        for (const name of names) {
          if (blob.includes(name)) continue;
          const rel = c.file.startsWith(croot + sep) ? c.file.slice(croot.length + 1) : c.file;
          violations.push({
            rule_id: RULE, file: rel, line: 1, col: 0,
            evidence:
              `the wagon declares it ${kind === "produce" ? "produces" : "consumes"} ` +
              `"${name}", and no wagon implementation names it; the declared contract and ` +
              `the Cargo it actually moves are free to disagree`,
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
