// ts_metrics.mjs — native Bun port of the four PYTHON TypeScript detectors that
// ship under atdd.workspace.python-pytest. Lives at the implementation ROOT
// (imported by checks via `../ts_metrics.mjs`); the family runner only spawns
// `checks/*.mjs`, so this module is never run as a member.
//
// WHY A PORT IS SOUND. Every one of those detectors states in its own manifest
// that it "inspects TypeScript SOURCE via regex normalization, it does not execute
// TS". None of them needs a Python library — no radon, no tree-sitter, no AST.
// They are deterministic string algorithms that happen to be written in Python, so
// a faithful port changes the host language and nothing else. The thresholds, the
// regexes, the formulas and the skip rules below are transcribed from those
// modules so a repo gets the same numbers from either provider.
//
// PARITY NOTES — the three places Python and JavaScript regex differ, handled:
//   * `re.MULTILINE` -> the `m` flag; `re.DOTALL` -> `[\s\S]` (JS has no `s` in
//     older engines and `[\s\S]` is unambiguous).
//   * `re.findall` returns GROUPS when the pattern has capturing groups. Every
//     ported pattern uses non-capturing `(?:...)`, so `matchAll` length is the
//     same count Python produced.
//   * `math.log`/`log2`/`sin`/`sqrt` -> `Math.*`, identical IEEE-754 doubles.
//
// The one deliberate UPGRADE is in the import graph — see `moduleImports` below.
import { extname, dirname, resolve as resolvePath, basename, sep } from "node:path";

// ── thresholds (transcribed from the Python detectors) ────────────────────────
export const MAX_CYCLOMATIC = 10;   // complexity_typescript.py
export const MAX_NESTING = 4;
export const MAX_FUNCTION_LINES = 50;
export const MIN_MI = 20;           // quality_metrics_typescript.py
export const MIN_COMMENT_RATIO = 0.10;
export const DUP_MIN_LINES = 7;     // duplication_typescript.py
export const TS_EXT = new Set([".ts", ".tsx"]);

// ── function extraction (complexity_typescript.py) ────────────────────────────
const FUNC_PATTERNS = [
  /^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:<[^>]*>)?\s*\(/gm,
  /^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?::\s*[^=]+?)?\s*=\s*(?:async\s+)?(?:function\s*)?(?:<[^>]*>)?\s*\(/gm,
];

function findOpeningBrace(content, start) {
  let parenDepth = 0;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    else if (ch === "{" && parenDepth === 0) return i;
    else if (ch === "\n" && parenDepth === 0) {
      const segment = content.slice(start, i);
      if (segment.includes("=>") && !segment.includes("{")) return -1;
    }
  }
  return -1;
}

// String/comment aware brace matcher, so a `}` inside a string or comment never
// closes a body early.
function matchBraces(content, openPos) {
  let depth = 0, i = openPos, inString = null;
  let inLineComment = false, inBlockComment = false;
  while (i < content.length) {
    const ch = content[i];
    if (inLineComment) { if (ch === "\n") inLineComment = false; i++; continue; }
    if (inBlockComment) {
      if (ch === "*" && content[i + 1] === "/") { inBlockComment = false; i += 2; continue; }
      i++; continue;
    }
    if (inString) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inString) inString = null;
      i++; continue;
    }
    if (ch === "/" && content[i + 1] === "/") { inLineComment = true; i += 2; continue; }
    if (ch === "/" && content[i + 1] === "*") { inBlockComment = true; i += 2; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { inString = ch; i++; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

export function extractFunctions(content) {
  const out = [];
  for (const pattern of FUNC_PATTERNS) {
    for (const m of content.matchAll(pattern)) {
      const name = m[1];
      const line = content.slice(0, m.index).split("\n").length;
      const end = m.index + m[0].length;
      // The Python port passes `match.end() - 1` — the index OF the params' "(" —
      // so the parameter parenthesis balances and the body brace is actually
      // found. Passing `match.end()` (as the original core did) drives paren_depth
      // to -1 before the body and truncates every function to its signature,
      // which silently makes all three metrics inert. Preserved deliberately.
      const bodyStart = findOpeningBrace(content, end - 1);
      if (bodyStart === -1) {
        let stmtEnd = content.indexOf("\n", end);
        if (stmtEnd === -1) stmtEnd = content.length;
        out.push({ name, line, body: content.slice(m.index, stmtEnd) });
        continue;
      }
      const bodyEnd = matchBraces(content, bodyStart);
      if (bodyEnd === -1) continue;
      out.push({ name, line, body: content.slice(m.index, bodyEnd + 1) });
    }
  }
  return out;
}

const countMatches = (text, re) => (text.match(re) || []).length;

export function cyclomatic(body) {
  let c = 1;
  for (const kw of [/\bif\b/g, /\belse\s+if\b/g, /\bfor\b/g, /\bwhile\b/g,
                    /\bdo\b/g, /\bcatch\b/g, /\bcase\b/g]) c += countMatches(body, kw);
  c += countMatches(body, /&&/g);
  c += countMatches(body, /\|\|/g);
  c += countMatches(body, /\?\?/g);
  c += countMatches(body, /[^\s?]\s*\?(?![\s.?:])\s*[^:]/g);
  return c;
}

export function nestingDepth(body) {
  const CONTROL = /\b(if|else|for|while|do|switch|try|catch|finally)\b/;
  let maxDepth = 0, braceDepth = 0, baseDepth = null;
  for (const line of body.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("//") || s.startsWith("/*")) continue;
    const opens = (s.match(/\{/g) || []).length;
    const closes = (s.match(/\}/g) || []).length;
    if (baseDepth === null && opens > 0) baseDepth = braceDepth;
    const hasControl = CONTROL.test(s);
    braceDepth += opens - closes;
    if (hasControl && opens > 0) maxDepth = Math.max(maxDepth, braceDepth - (baseDepth || 0));
  }
  return maxDepth;
}

export function countCodeLines(body) {
  let count = 0, inBlock = false;
  for (const line of body.split("\n")) {
    const s = line.trim();
    if (inBlock) { if (s.includes("*/")) inBlock = false; continue; }
    if (s.startsWith("/*")) { if (!s.includes("*/")) inBlock = true; continue; }
    if (!s || s.startsWith("//")) continue;
    count++;
  }
  return count;
}

// ── maintainability index (quality_metrics_typescript.py) ─────────────────────
const OPERATORS = /(?:===|!==|==|!=|>=|<=|=>|&&|\|\||>>>=|>>>|>>=|<<=|\?\?|\?\.|[+\-*/%&|^~!<>=]=?|\.\.\.|[{}()[\];,.:?])/g;
const OPERANDS = /(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d[\d_.eExXbBoO]*\b|\b[a-zA-Z_$][a-zA-Z0-9_$]*\b)/g;
const CC_KEYWORDS = /\b(?:if|else\s+if|for|while|do|catch|case|&&|\|\|)\b/g;

export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function halsteadVolume(src) {
  const operators = src.match(OPERATORS) || [];
  const operands = src.match(OPERANDS) || [];
  const n = new Set(operators).size + new Set(operands).size;
  const N = operators.length + operands.length;
  if (n <= 1) return 1.0;
  return N * Math.log2(n);
}

export function commentRatio(src) {
  let total = 0, comments = 0, inBlock = false;
  for (const line of src.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    total++;
    if (inBlock) { comments++; if (s.includes("*/")) inBlock = false; continue; }
    if (s.startsWith("/*")) { comments++; if (!s.includes("*/")) inBlock = true; continue; }
    if (s.startsWith("//") || s.startsWith("*")) { comments++; continue; }
  }
  return total > 0 ? comments / total : 0.0;
}

export function maintainabilityIndex(source) {
  const code = stripComments(source);
  const loc = code.split("\n").filter((l) => l.trim()).length;
  if (loc === 0) return 100.0;
  let V = halsteadVolume(code);
  if (V <= 0) V = 1.0;
  const cc = (source.match(CC_KEYWORDS) || []).length;
  const funcCount = Math.max(1, (source.match(/\bfunction\b/g) || []).length +
                                (source.match(/=>\s*[{(]/g) || []).length);
  const avgCc = Math.max(1, cc) / funcCount;
  const cm = commentRatio(source);
  const mi = 171 - 5.2 * Math.log(V) - 0.23 * avgCc - 16.2 * Math.log(loc)
             + 50.0 * Math.sin(Math.sqrt(2.4 * cm));
  return Math.max(0.0, Math.min(100.0, mi));
}

// ── duplication (duplication_typescript.py) ───────────────────────────────────
export function determineLayer(filePath) {
  const p = filePath.toLowerCase();
  if (p.includes("/domain/")) return "domain";
  if (p.includes("/application/")) return "application";
  if (p.includes("/presentation/")) return "presentation";
  if (p.includes("/integration/") || p.includes("/infrastructure/")) return "integration";
  if (p.includes("/entities/") || p.includes("/models/") || p.includes("/value_objects/")) return "domain";
  if (p.includes("/use_cases/") || p.includes("/usecases/") || p.includes("/hooks/")) return "application";
  if (p.includes("/components/") || p.includes("/pages/") || p.includes("/views/")) return "presentation";
  if (p.includes("/adapters/") || p.includes("/clients/") || p.includes("/api/")) return "integration";
  return "unknown";
}

const NORMALIZE = [
  [/\/\/.*$/gm, ""],
  [/\/\*[\s\S]*?\*\//g, ""],
  [/'[^']*'/g, '"S"'],
  [/"[^"]*"/g, '"S"'],
  [/`[^`]*`/g, '"S"'],
  [/\b\d+\.?\d*\b/g, "0"],
  [/\b(?!(?:import|export|from|const|let|var|function|class|interface|type|if|else|for|while|do|switch|case|break|continue|return|throw|try|catch|finally|new|delete|typeof|instanceof|void|in|of|as|is|async|await|extends|implements|static|get|set|public|private|protected|readonly|abstract|override|enum|namespace|module|declare|default|yield|super|this|true|false|null|undefined|never|any|string|number|boolean|object|unknown|void|Promise|Array|Map|Set|Record)\b)[a-zA-Z_$][a-zA-Z0-9_$]*/g, "ID"],
];

export function normalizeLine(line) {
  let r = line.trim();
  if (!r) return "";
  for (const [re, sub] of NORMALIZE) r = r.replace(re, sub);
  return r.replace(/\s+/g, " ").trim();
}

const TRIVIAL = new Set(["", "{", "}", "};", ");", "],", ")", "]", "});"]);
export const isTrivial = (n) => TRIVIAL.has(n);

// A 16-hex-char digest of each `minLines` window of non-trivial normalized lines —
// the same fingerprint shape the Python detector hashes with sha256[:16].
export function fragments(source, minLines, hasher) {
  const nonTrivial = [];
  source.split("\n").forEach((line, i) => {
    const n = normalizeLine(line);
    if (!isTrivial(n)) nonTrivial.push([i + 1, n]);
  });
  if (nonTrivial.length < minLines) return [];
  const out = [];
  for (let i = 0; i <= nonTrivial.length - minLines; i++) {
    const window = nonTrivial.slice(i, i + minLines);
    const block = window.map(([, l]) => l).join("\n");
    out.push({ hash: hasher(block), start: window[0][0], end: window[window.length - 1][0] });
  }
  return out;
}

// ── import graph (dead_code_typescript.py) — THE ONE UPGRADE ─────────────────
//
// The Python detector reads imports with five regexes — the best a Python process
// can do without a TypeScript parser — and cannot distinguish
// `import type { T } from "./t"` from a value import, so a module whose only
// referrer is a TYPE import is counted as reachable. A type-only import is erased
// at compile time and creates no runtime edge, so that module is dead and the regex
// reports it alive.
//
// Bun ships a real TypeScript parser in-process, which omits type-only imports.
// Same obligation, measured correctly — and available only because the runtime is
// Bun. The resolver itself now lives in ../../lib/imports.mjs, shared with the
// clean-architecture family.
export { moduleImports } from "../../lib/imports.mjs";

export const ROOT_FILENAMES = new Set(["index.ts", "index.tsx", "wagon.ts", "composition.ts"]);
// `server.ts` is the canonical Bun entrypoint (Bun.serve) and the Station Master in
// 17 of the interlocking family's own fixtures. Omitting it reported a whole feature
// tree as dead code for consumers built the way that family prescribes.
export const ENTRY_FILENAMES = new Set(["main.ts", "main.tsx", "app.ts", "app.tsx", "server.ts"]);
export const STRUCTURAL = new Set(["index.ts", "index.tsx"]);

export function resolveImport(specifier, sourceFile, allFiles, root) {
  const candidates = new Set();
  let base = null;
  if (specifier.startsWith(".")) base = resolvePath(dirname(sourceFile), specifier);
  else if (specifier.startsWith("@/")) base = resolvePath(root, specifier.slice(2));
  if (base === null) return candidates;   // external npm specifier: outside the graph
  for (const ext of [".ts", ".tsx"]) {
    const withExt = base.replace(/\.[^./]*$/, "") === base ? base + ext : base.replace(/\.[^./]*$/, ext);
    if (allFiles.has(withExt)) candidates.add(withExt);
    if (allFiles.has(base + ext)) candidates.add(base + ext);
    if (allFiles.has(`${base}${sep}index${ext}`)) candidates.add(`${base}${sep}index${ext}`);
  }
  if (allFiles.has(base)) candidates.add(base);
  return candidates;
}

export const isTestFile = (f) => /\.(test|spec)\.tsx?$/.test(f) ||
  f.split(sep).some((p) => p === "__tests__" || p === "tests" || p === "test");

export const isRootFile = (f) => ROOT_FILENAMES.has(basename(f)) || ENTRY_FILENAMES.has(basename(f));

export function reachableFrom(roots, graph) {
  const visited = new Set();
  const queue = [...roots];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const n of graph.get(cur) || []) if (!visited.has(n)) queue.push(n);
  }
  return visited;
}

export function reverseGraph(graph) {
  const rev = new Map([...graph.keys()].map((k) => [k, new Set()]));
  for (const [src, targets] of graph) {
    for (const t of targets) if (rev.has(t)) rev.get(t).add(src);
  }
  return rev;
}
