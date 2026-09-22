// Shared helpers for the bun_interlocking_infrastructure FAMILY detector.
// The Bun/TS realization of the core python `interlocking_infrastructure.py` AST
// detector (core afokapu/atdd#1246/#1251), mirroring convex.workspace.runtime's
// convex_interlocking_infrastructure 1:1. Each check under ../checks/*.mjs imports
// this module and scans a consumer tree for ONE coder.bun.interlocking-* rule.
//
// ZERO third-party deps — node/bun builtins only, regex over source (the established
// detector style across this provider and convex.workspace.runtime; no TS AST runtime).
//
// THE BUN LAYOUT, and why each path is what it is:
//   src/trains/**/*.ts   the InterlockingRunner route-control layer.
//                        Mirrors python/trains/** and convex/trains/**. `src/` is this
//                        stack's backend root — it is where coder.bun.layer-naming and
//                        the green-urn rules already place `features/` and `wagons/`.
//   server.ts            the Station Master. Mirrors python/app.py and convex/app.ts.
//                        `coder.bun.composition-root` already names server.ts as a
//                        composition root, "because Bun.serve IS the composition root",
//                        and `coder.bun.runtime-server-is-bun-serve` requires Bun.serve
//                        to be the only server primitive. src/server.ts is also accepted.
//   src/**/wagon.ts      wagons, excluding the trains/ runtime subtree.
//                        Mirrors python/<wagon>/wagon.py and convex/<wagon>/wagon.ts;
//                        `wagon.ts` is already vocabulary in coder.bun.composition-root.

import { readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { join, sep, basename } from "node:path";

export const DEFAULT_EXCLUDES = ["_generated", "node_modules", "dist", "build", ".next"];

// Structured-resolution model contract, TS camelCase, transcribed from core's own
// InterlockingResolution (src/atdd/runtime/interlocking/runner.py).
//
// No categoryDigit: core retired the interlocking category digit (#1421 / #1440), its schema
// rejects the key, and a typed train:<subject>:<slug> has no digit to carry. Requiring it made
// this rule reject every consumer core considers valid.
//
// guardId stays — only the PLAN key changed (guard_id -> guard_ref); the runtime model keeps the
// field, populated from route.guard_ref. resolutionStrategy is added: core carries it and this
// rule never asked for it.
export const REQUIRED_RESOLUTION_FIELDS = [
  "interlockingId",
  "routeId",
  "trainId",
  "trainPath",
  "category",
  "guardId",
  "resolutionStrategy",
  "reason",
];

export function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function readText(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

// The caller's excludes, merged with the defaults. core passes ATDD_SCAN_EXCLUDES
// (it carries `.atdd/workspaces`, among others) and cli/scan.py and adapter/run.py
// both merge it in; this family read only its own DEFAULT_EXCLUDES and discarded it.
// Matching follows lib/scan.mjs: a whole path segment OR a substring, so a
// multi-segment glob like `.atdd/workspaces` can match at all — segment-only
// comparison could never match one.
const SCAN_EXCLUDES = (() => {
  let extra = [];
  try {
    const raw = process.env.ATDD_SCAN_EXCLUDES;
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) extra = v.filter((x) => typeof x === "string");
    }
  } catch {
    /* malformed env must not silence the scan */
  }
  return [...new Set([...DEFAULT_EXCLUDES, ...extra])];
})();

function isExcluded(path) {
  const segments = path.split(sep);
  return SCAN_EXCLUDES.some((ex) => segments.includes(ex) || path.includes(ex));
}

function hasChildDir(dir, name) {
  try {
    return statSync(join(dir, name)).isDirectory();
  } catch {
    return false;
  }
}

function* walkDirs(root) {
  let st;
  try {
    st = statSync(root);
  } catch {
    return;
  }
  if (!st.isDirectory()) return;
  yield root;
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (isExcluded(full)) continue;
    let cst;
    try {
      cst = statSync(full);
    } catch {
      continue;
    }
    if (cst.isDirectory()) yield* walkDirs(full);
  }
}

// A consumer root is any directory that DIRECTLY contains a `src/`, `plan/`, or `e2e/`
// subdir. This resolves both a single-tree scan root AND a combined scan root that holds
// several per-alias consumer trees as immediate children (the family conformance combined run).
export function findConsumerRoots(scanRoot) {
  const roots = new Set();
  for (const d of walkDirs(scanRoot)) {
    if (hasChildDir(d, "src") || hasChildDir(d, "plan") || hasChildDir(d, "e2e")) roots.add(d);
  }
  return [...roots];
}

function* walkTsFiles(dir) {
  let st;
  try {
    st = statSync(dir);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (dir.endsWith(".ts") || dir.endsWith(".tsx")) yield dir;
    return;
  }
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (isExcluded(full)) continue;
    let cst;
    try {
      cst = statSync(full);
    } catch {
      continue;
    }
    if (cst.isDirectory()) yield* walkTsFiles(full);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) yield full;
  }
}

// The InterlockingRunner runtime lives under src/trains/**/*.ts (mirror python/trains).
export function runtimeFiles(croot) {
  return [...walkTsFiles(join(croot, "src", "trains"))].sort();
}

// The Station Master at server.ts (mirror python/app.py, convex/app.ts). Accepted at the
// consumer root or under src/ — both are legitimate homes for the Bun.serve entry, and
// coder.bun.composition-root names server.ts either way.
export function appFile(croot) {
  for (const p of [join(croot, "server.ts"), join(croot, "src", "server.ts")]) {
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

// Wagons at src/**/wagon.ts, excluding the trains/ runtime subtree (mirror python).
export function wagonFiles(croot) {
  const base = join(croot, "src");
  const trains = join(croot, "src", "trains") + sep;
  const out = [];
  for (const f of walkTsFiles(base)) {
    if (basename(f) === "wagon.ts" && !f.startsWith(trains)) out.push(f);
  }
  return out.sort();
}

export function rel(path, root) {
  const r = root.endsWith(sep) ? root : root + sep;
  return path.startsWith(r) ? path.slice(r.length) : path;
}

export function lineOfIndex(text, idx) {
  return text.slice(0, idx).split("\n").length;
}

export function lineAt(text, lineno) {
  const lines = text.split(/\r?\n/);
  return lineno >= 1 && lineno <= lines.length ? lines[lineno - 1].trim() : "";
}

export function mk(ruleId, file, line, col, evidence, sourceLine) {
  return { rule_id: ruleId, file, line, col, evidence, source_line: sourceLine };
}

// Blank out `//` line comments and `/* */` block comments to spaces (preserving offsets, length,
// and newlines) so keyword scanning never matches text that only appears in a comment. String
// literals are LEFT INTACT — a `"artifact_urn"` literal must still be detectable. The python
// original scanned an AST, which is comment-immune by construction; this is the regex equivalent.
export function maskComments(text) {
  const out = text.split("");
  const n = text.length;
  let i = 0;
  let state = "code";
  while (i < n) {
    const c = text[i];
    const d = i + 1 < n ? text[i + 1] : "";
    if (state === "code") {
      if (c === "/" && d === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        state = "line";
        continue;
      }
      if (c === "/" && d === "*") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        state = "block";
        continue;
      }
      if (c === "'") {
        i++;
        state = "sq";
        continue;
      }
      if (c === '"') {
        i++;
        state = "dq";
        continue;
      }
      if (c === "`") {
        i++;
        state = "tpl";
        continue;
      }
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        i++;
        continue;
      }
      out[i] = " ";
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        state = "code";
        continue;
      }
      if (c !== "\n") out[i] = " ";
      i++;
      continue;
    }
    if (state === "sq" || state === "dq") {
      const q = state === "sq" ? "'" : '"';
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === q) {
        i++;
        state = "code";
        continue;
      }
      i++;
      continue;
    }
    // tpl
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") {
      i++;
      state = "code";
      continue;
    }
    i++;
  }
  return out.join("");
}

export function hasRunnerClass(text) {
  return /\bclass\s+InterlockingRunner\b/.test(maskComments(text));
}

export function runnerClassLine(text) {
  const m = /\bclass\s+InterlockingRunner\b/.exec(maskComments(text));
  return m ? lineOfIndex(text, m.index) : 1;
}

export function hasResolveTrain(text) {
  // A `resolveTrain(` method/function anywhere in an InterlockingRunner-defining module.
  return /\bresolveTrain\s*\(/.test(maskComments(text));
}

// Field names of an `InterlockingResolution` interface/class/type block, or null if the
// declaration is absent (mirror python: None when the class is missing).
export function resolutionModelFields(rawText) {
  const text = maskComments(rawText);
  const decl = /\b(?:interface|class|type)\s+InterlockingResolution\b[^{]*\{/.exec(text);
  if (!decl) return null;
  const open = decl.index + decl[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const body = close > 0 ? text.slice(open + 1, close) : text.slice(open + 1);
  const fields = new Set();
  const propRe = /(?:^|[;{,\n])\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[?!]?\s*:/g;
  let m;
  while ((m = propRe.exec(body)) !== null) fields.add(m[1]);
  return fields;
}

// Inspect a JOURNEY_MAP object literal. Returns {hasInterlocking, hasDirect, interlockingLine}.
// An interlocking route object carries an `interlockingId` (or snake `interlocking_id`) key; a
// direct route is a bare train_id string value.
export function journeyMap(rawText) {
  const text = maskComments(rawText);
  const m = /\bJOURNEY_MAP\b[^=]*=\s*\{/.exec(text);
  if (!m) return { hasInterlocking: false, hasDirect: false, interlockingLine: 0 };
  const open = m.index + m[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const body = close > 0 ? text.slice(open + 1, close) : text.slice(open + 1);
  const im = /\binterlocking(?:Id|_id)\b/.exec(body);
  const hasInterlocking = im !== null;
  const hasDirect = /:\s*["'][^"']+["']\s*[,}]/.test(body);
  const interlockingLine = im ? lineOfIndex(text, open + 1 + im.index) : lineOfIndex(text, open);
  return { hasInterlocking, hasDirect, interlockingLine };
}

export function referencesToken(text, tok) {
  return new RegExp("\\b" + tok + "\\b").test(maskComments(text));
}

// import statements pulling in a wagon module (a path segment === "wagon").
export function importsWagon(rawText) {
  const text = maskComments(rawText);
  const out = [];
  const re = /^\s*import\b[^\n]*?from\s*["']([^"']+)["'][^\n]*$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const segs = m[1].split("/").map((s) => s.replace(/\.(ts|tsx|js|mjs)$/, ""));
    if (segs.includes("wagon")) {
      const line = lineOfIndex(text, m.index);
      out.push({ line, src: lineAt(rawText, line) });
    }
  }
  return out;
}

export function runTrainCalls(rawText) {
  const text = maskComments(rawText);
  const out = [];
  const re = /\brunTrain\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const line = lineOfIndex(text, m.index);
    out.push({ line, src: lineAt(rawText, line) });
  }
  return out;
}

// `for (const step of <expr>.sequence)` — an interlocking acting as a step executor.
export function sequenceLoops(rawText) {
  const text = maskComments(rawText);
  const out = [];
  const re = /\bfor\s*\([^)]*\bof\s+[\w.$]+\.sequence\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const line = lineOfIndex(text, m.index);
    out.push({ line, src: lineAt(rawText, line) });
  }
  return out;
}

// Cargo bleed into the interlocking layer: the Cargo symbol, a `cargo[...] =` mutation, or an
// artifact_urn literal (mirror python _cargo_uses). Comments are masked; string literals are kept
// so an artifact_urn string is still detected.
export function cargoUses(rawText) {
  const text = maskComments(rawText);
  const out = [];
  let m;
  let re = /\bCargo\b/g;
  while ((m = re.exec(text)) !== null) {
    const line = lineOfIndex(text, m.index);
    out.push({ line, detail: "references the Cargo symbol", src: lineAt(rawText, line) });
  }
  re = /\bcargo\s*\[[^\]]*\]\s*=(?!=)/g;
  while ((m = re.exec(text)) !== null) {
    const line = lineOfIndex(text, m.index);
    out.push({ line, detail: "mutates a cargo mapping", src: lineAt(rawText, line) });
  }
  re = /\bartifact_urn\b|\bartifactUrn\b/g;
  while ((m = re.exec(text)) !== null) {
    const line = lineOfIndex(text, m.index);
    out.push({ line, detail: "stores an artifact_urn value", src: lineAt(rawText, line) });
  }
  return out;
}

// import statements in a wagon that pull in interlocking code (Cargo boundary violation).
export function importsInterlocking(rawText) {
  const text = maskComments(rawText);
  const out = [];
  const re = /^\s*import\b([^\n]*?)from\s*["']([^"']+)["'][^\n]*$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const names = m[1];
    const segs = m[2].split("/");
    if (segs.some((s) => /interlocking/i.test(s)) || /\bInterlockingRunner\b/.test(names)) {
      const line = lineOfIndex(text, m.index);
      out.push({ line, src: lineAt(rawText, line) });
    }
  }
  return out;
}

// Runner modules of a consumer root: {file, text} for each src/trains file defining the runner.
export function runnerModules(croot) {
  return runtimeFiles(croot)
    .map((f) => ({ file: f, text: readText(f) }))
    .filter((x) => hasRunnerClass(x.text));
}

export function writeReport(violations) {
  const rp = process.env.ATDD_VIOLATIONS_REPORT;
  if (!rp) {
    process.stderr.write("bun-interlocking: ATDD_VIOLATIONS_REPORT not set\n");
    process.exit(2);
  }
  writeFileSync(rp, JSON.stringify({ violations }, null, 2), "utf8");
  process.exit(0);
}
