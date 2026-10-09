#!/usr/bin/env bun
// coder.bun.runtime-executes-the-declaration (GATED — was staged)
//
// The coder half of the executes-the-declaration pair: the runtime must EXECUTE the
// declared route space, not transcribe it. Every other rule in this family closes a
// TEXT-level correspondence — literals in the runtime also appear in the plan — and
// none asks whether the runtime ever READS it.
//
// FIRES ON POSITIVE EVIDENCE, NOT ON ABSENCE. The python sibling reports when nothing
// under the runtime selector reads a file. That design does not survive this stack: a
// runtime can legitimately obtain its route space through a generated module or a
// query and read no file at all, and would be called plan-blind for being idiomatic.
// This fires only when BOTH hold — the runtime reads nothing AND it restates declared
// route/train values as literals. Transcription PROVEN, not loading merely unproven.
//
// SELF-CONTAINED ON PURPOSE. The sibling detect.mjs exports nothing and calls main()
// at import time, so its helpers cannot be reused from here. The duplication below is
// the cost of that shape; extracting detect.mjs's walkers into a _shared/ module both
// can import is the right follow-up, and is a refactor of a live gated detector rather
// than something to smuggle into a staged one.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

export const RULE_EXECUTES = "coder.bun.runtime-executes-the-declaration";

// A FILE READ, not a parse. `parse(x)` alone says nothing about where x came from.
// Vocabulary established by building a consumer in this stack: python reads with
// yaml.safe_load / read_text, bun with Bun.file(...).text(), convex with readFileSync.
const LOADS_DECLARATION =
  /\breadFileSync\s*\(|\breadFile\s*\(|\bBun\s*\.\s*file\s*\(|\bcreateReadStream\s*\(|\bfs\s*\.\s*promises\s*\.\s*readFile\b/;
const RESOLVES = /\bInterlockingResolution\b|\bresolveTrain\s*\(/;
const TRAIN_RUNNER = /\bclass\s+TrainRunner\b/;
const EXCLUDES = ["node_modules", "dist", "build", ".next", "_generated"];
const PLAN_ROOT = process.env.ATDD_PLAN_ROOT || "plan";

const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

function walk(dir, pred) {
  const out = [];
  (function rec(d) {
    let entries; try { entries = readdirSync(d).sort(); } catch { return; }
    for (const n of entries) {
      if (EXCLUDES.includes(n)) continue;
      const full = join(d, n);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) rec(full);
      else if (pred(full)) out.push(full);
    }
  })(dir);
  return out;
}

export function findConsumerRoots(scanRoot) {
  const roots = new Set();
  (function rec(d) {
    let st; try { st = statSync(d); } catch { return; }
    if (!st.isDirectory()) return;
    for (const marker of ["src", PLAN_ROOT, "e2e"]) {
      try { if (statSync(join(d, marker)).isDirectory()) { roots.add(d); break; } } catch {}
    }
    let entries; try { entries = readdirSync(d).sort(); } catch { return; }
    for (const n of entries) { if (!EXCLUDES.includes(n)) { try { if (statSync(join(d, n)).isDirectory()) rec(join(d, n)); } catch {} } }
  })(scanRoot);
  return [...roots];
}

// Only what this check needs: the declared route_id / train_id of each route.
export function declaredValues(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const l of lines) {
    const m = l.match(/^\s*-?\s*(?:route_id|train_id):\s*["']?([^"'#\n]+?)["']?\s*(?:#.*)?$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Does this module — or a loader it actually USES — read a declaration?
//
// Following imports blindly is too generous: a resolver that imports TrainRunner
// (which reads TRAIN files, not the interlocking declaration) would be exempted by
// its neighbour's reads, which is the whole defect one level up. So a delegated
// read only counts when the imported binding is REFERENCED in the module body —
// an honest resolver calling `loadDeclaration(...)` is exempt, a hardcoded one
// that merely imports a reader is not.
export function loadsWithImports(mod, allFiles) {
  if (LOADS_DECLARATION.test(mod.text)) return true;
  const body = mod.text.replace(/^\s*import\s[^;]*;?$/gm, "");
  for (const m of mod.text.matchAll(/import\s+(\{[^}]*\}|[\w*\s]+?)\s+from\s+["'](\.[^"']+)["']/g)) {
    const names = m[1].replace(/[{}*]/g, " ").split(/[\s,]+/)
      .map((n) => n.trim()).filter((n) => n && n !== "as" && n !== "type");
    if (!names.some((n) => new RegExp(`\\b${n}\\b`).test(body))) continue;  // imported, never used
    const tail = m[2].replace(/^.*\//, "").replace(/\.(ts|tsx|mjs|js)$/, "");
    const hit = allFiles.find(
      (f) => f !== mod && /\.(ts|tsx|mjs|js)$/.test(f.file) &&
        f.file.replace(/^.*[\\/]/, "").replace(/\.(ts|tsx|mjs|js)$/, "") === tail,
    );
    if (hit && LOADS_DECLARATION.test(hit.text)) return true;
  }
  return false;
}

// Blank out comments, preserving string literals — a declared id inside a string is
// the evidence; the same id inside a comment is prose.
export function maskComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

export function scanExecution(scanRoot) {
  const violations = [];
  for (const croot of findConsumerRoots(scanRoot)) {
    const ilFiles = walk(join(croot, PLAN_ROOT), (f) => /_interlockings[/\\].*\.ya?ml$/.test(f));
    const declared = [...new Set(ilFiles.flatMap((f) => declaredValues(readText(f))))];
    if (!declared.length) continue;
    const rtFiles = walk(join(croot, "src/trains"), (f) => /\.(ts|tsx|mjs|js)$/.test(f))
      .map((f) => ({ file: f, text: readText(f) }));
    const resolving = rtFiles.filter((x) => RESOLVES.test(x.text));
    if (!resolving.length) continue;
    // TRANSCRIPTION IS THE EVIDENCE, and a read no longer excuses it.
    //
    // This required BOTH — reads nothing AND restates literals — which let PARTIAL
    // ADOPTION through: a resolver reading the plan for `interlocking_id` while
    // hardcoding the entire route space passed, and deleting every route from the
    // plan left it dispatching. That is what a half-finished migration looks like,
    // so it is the shape most likely to be real.
    //
    // A data-driven resolver DERIVES route and train ids; it has no reason to name
    // one as a literal. Measured before loosening the guard: zero declared literals
    // in two working consumers and in this package's own clean fixture, two in the
    // partial-adoption mutant. So restating a declared id is transcription evidence
    // whether or not some read also happens.
    //
    // Comments are masked: a route id MENTIONED in prose is documentation, not
    // dispatch, and the earlier wagon-contract rule was silenced by exactly that.
    const transcribed = [...new Set(
      resolving.flatMap((x) => declared.filter((v) =>
        new RegExp(`(?<![\\w-])${esc(v)}(?![\\w-])`).test(maskComments(x.text)))),
    )].sort();
    // TWO WAYS TO IGNORE A DECLARATION, and a mutant sweep found both. Transcription
    // catches PARTIAL ADOPTION (reads the plan for one field, hardcodes the route
    // space). Reading nothing catches a resolver rewritten to derive from an EMPTY
    // route space, which transcribes no id at all. Each was the other's blind spot.
    const readsNothing = !resolving.some((x) => loadsWithImports(x, rtFiles));
    if (!transcribed.length && !readsNothing) continue;   // derives from what it loaded
    const rel = resolving[0].file.startsWith(croot + sep) ? resolving[0].file.slice(croot.length + 1) : resolving[0].file;
    violations.push({
      rule_id: RULE_EXECUTES, file: rel, line: 1, col: 0,
      evidence: (readsNothing
          ? `the InterlockingRunner runtime never reads the interlocking declaration and `
          : `the InterlockingRunner runtime reads its declaration but restates the route space, and `) +
        `restates ${transcribed.length} declared value(s) as literals (${transcribed.join(", ")}); ` +
        `the route space is transcribed, not executed — delete the plan and this runtime keeps answering`,
      source_line: "",
    });
  }
  return violations;
}

// TrainRunner is the other half of declaration execution. A correctly data-driven
// InterlockingRunner can select a train while its executor silently ignores that
// train and returns a hand-written trace. Require the executor itself to read a
// supplied train declaration, iterate its declared sequence, and feed each wagon's
// production result into the next call. These deliberately structural checks admit
// ordinary direct functions (executeWagon/runWagon/runTrain) without prescribing a
// framework, while rejecting the no-op and literal-trace shapes they replace.
export function scanTrainRunnerExecution(scanRoot) {
  const violations = [];
  for (const croot of findConsumerRoots(scanRoot)) {
    const trainDeclarations = walk(join(croot, PLAN_ROOT, "_trains"), (f) => /train:.*\.ya?ml$/.test(f));
    if (!trainDeclarations.length) continue;
    const rtFiles = walk(join(croot, "src/trains"), (f) => /\.(ts|tsx|mjs|js)$/.test(f))
      .map((f) => ({ file: f, text: readText(f) }));
    for (const runner of rtFiles.filter((x) => TRAIN_RUNNER.test(x.text))) {
      const readsDeclaration = LOADS_DECLARATION.test(runner.text);
      const usesSuppliedDeclaration = /\b(?:parse|load)(?:Train|Declaration)\s*\(\s*this\.\w*(?:train|declaration|path)\w*\s*\)/i.test(runner.text) ||
        /\b(?:readFileSync|readFile|Bun\s*\.\s*file)\s*\(\s*this\.\w*(?:train|declaration|path)\w*/i.test(runner.text);
      const parsesSequence = /\bsequence\b/.test(runner.text);
      const derivesOrder = /for\s*\(\s*const\s+\w+\s+of\s+\w+\.sequence\s*\)/.test(runner.text);
      // The reassignment is the key data-flow proof: a production execution call
      // receives the prior result and its output becomes the next result.
      const carriesResults = /\b(\w+)\s*=\s*(?:await\s+)?(?:execute|run)\w*\s*\(\s*\w+\s*,\s*\1\s*\)/.test(runner.text);
      const fabricatesTrace = /\b(?:trace|steps?|sequence)\s*:\s*\[\s*["'`]/.test(maskComments(runner.text));
      if (readsDeclaration && usesSuppliedDeclaration && parsesSequence && derivesOrder && carriesResults && !fabricatesTrace) continue;
      const missing = [
        !readsDeclaration && "read the supplied train declaration",
        !usesSuppliedDeclaration && "pass its supplied declaration into that parser or reader",
        !parsesSequence && "parse its sequence",
        !derivesOrder && "derive ordered iteration from train.sequence",
        !carriesResults && "carry each production execution result into the next wagon",
        fabricatesTrace && "avoid fabricating literal trace or step data",
      ].filter(Boolean).join("; ");
      const rel = runner.file.startsWith(croot + sep) ? runner.file.slice(croot.length + 1) : runner.file;
      violations.push({
        rule_id: RULE_EXECUTES, file: rel, line: 1, col: 0,
        evidence: `TrainRunner must ${missing}; declaration-selected wagon execution cannot be satisfied by a no-op or transcribed trace`,
        source_line: "",
      });
    }
  }
  return violations;
}

if (import.meta.main ?? process.argv[1]?.endsWith("interlocking_runtime_executes.mjs")) {
  let roots = [];
  try { roots = JSON.parse(process.env.ATDD_SCAN_ROOTS || "[]"); } catch {}
  const out = roots.flatMap((r) => [...scanExecution(r), ...scanTrainRunnerExecution(r)]);
  const rp = process.env.ATDD_VIOLATIONS_REPORT;
  if (rp) writeFileSync(rp, JSON.stringify({ violations: out }, null, 2), "utf8");
  process.stderr.write(`bun-executes: ${out.length} violation(s)\n`);
}
