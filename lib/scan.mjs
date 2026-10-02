// Shared scan-mount plumbing for every atdd.workspace.bun detector.
//
// The v1.1 provider contract is an ENV CHANNEL plus a JSON REPORT FILE:
//
//   INPUT   ATDD_SCAN_ROOTS      JSON array — the code-under-inspection roots.
//           ATDD_SCAN_EXCLUDES   JSON array — exclusion path fragments.
//           ATDD_VIOLATIONS_REPORT  path to write the JSON report to.
//   OUTPUT  {"violations": [{rule_id,file,line,col,evidence,source_line}, ...]}
//
// Every check obeys the mount: it walks ONLY the declared roots and never
// discovers the repo on its own. Factoring the walk here (rather than copying it
// into each check, as the node-runtime detectors do) keeps the nine checks to
// their actual detection logic — and keeps them under the duplication convention
// the coder extension itself enforces.
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, extname, sep, resolve, relative } from "node:path";

// Build output and vendored trees are never source-under-inspection. `.atdd` is
// excluded by the adapter, not here, because a consumer's `.atdd/config.yaml` is
// legitimate input for config-reading checks.
export const DEFAULT_EXCLUDES = ["node_modules", "dist", "build", ".next", ".git", "_generated"];

// Bun runs TS and ESM natively, so a full-stack Bun repo's source surface is
// exactly these; `.html` is included because htmx templates ARE the source.
export const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);
export const TEMPLATE_EXT = new Set([".html", ".htm"]);
export const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
// Playwright browser specs. They are tests, so a scan of implementation source never includes them,
// but they are not `bun test` files, so TEST_RE (which bun-test rules use to pick their files) excludes them.
export const E2E_RE = /\.e2e\.[cm]?[jt]sx?$/;
const isTestFile = (path) => TEST_RE.test(path) || E2E_RE.test(path);

export function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

// Excludes are matched against the path RELATIVE to the scan root that contains it, as whole consecutive segments:
// `build` excludes a folder named build, never `building`, and `.atdd/workspaces` still matches its two segments.
// Matching the absolute path by substring excluded every file of a checkout living under, say,
// ~/Github/frg-workstation-building-profile-activation, so every profile passed blind (FWS #U3vqdzo2RwFa).
const SCAN_ROOT_PATHS = (() => {
  try {
    const v = JSON.parse(process.env.ATDD_SCAN_ROOTS || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").map((r) => resolve(r)) : [];
  } catch { return []; }
})();
export function excludedPath(path, excludes) {
  const abs = resolve(path);
  const root = SCAN_ROOT_PATHS.filter((r) => abs === r || abs.startsWith(r + sep)).sort((a, b) => b.length - a.length)[0];
  const segs = (root ? relative(root, abs) : abs).split(/[\\/]+/).filter(Boolean);
  return excludes.some((ex) => {
    const parts = String(ex).split(/[\\/]+/).filter(Boolean);
    for (let i = 0; parts.length && i + parts.length <= segs.length; i++) if (parts.every((part, j) => segs[i + j] === part)) return true;
    return false;
  });
}

function isExcluded(path, excludes) {
  return excludedPath(path, excludes);
}

// Yield every file under `root` whose extension is in `exts`. `includeTests`
// defaults false: assertion code legitimately contains patterns the rules forbid
// in production source, so a check must opt in to seeing it.
export function* walk(root, excludes, exts, includeTests = false) {
  let st;
  try {
    st = statSync(root);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (exts.has(extname(root)) && (includeTests || !isTestFile(root))) yield root;
    return;
  }
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return;
  }
  for (const name of names) {
    const full = join(root, name);
    if (isExcluded(full, excludes)) continue;
    let cst;
    try {
      cst = statSync(full);
    } catch {
      continue;
    }
    if (cst.isDirectory()) {
      yield* walk(full, excludes, exts, includeTests);
    } else if (exts.has(extname(full)) && (includeTests || !isTestFile(full))) {
      yield full;
    }
  }
}

export function readRoots() {
  return parseJsonEnv("ATDD_SCAN_ROOTS", []);
}

export function readExcludes() {
  return [...DEFAULT_EXCLUDES, ...parseJsonEnv("ATDD_SCAN_EXCLUDES", [])];
}

// Mask string literals, template literals and comments with spaces of equal
// length, preserving every line and column offset. A check that greps raw source
// otherwise fires on the rule's own name inside a comment or a doc string — the
// classic detector false positive.
// A `/` starts a regex literal where an expression may begin: at the start, after an operator or opening
// punctuation, or after a keyword such as `return`. After a name, a number or `)` / `]` it is division.
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await", "instanceof"]);
function regexMayStart(text, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(text[k])) k--;
  if (k < 0) return true;
  const prev = text[k];
  if ("(,=:[!&|?{};+-*%>~^".includes(prev)) return true;   // not `<`: in TSX, `</b>` closes a tag
  if (/[\w$]/.test(prev)) {
    let w = k;
    while (w >= 0 && /[\w$]/.test(text[w])) w--;
    return REGEX_AFTER_WORD.has(text.slice(w + 1, k + 1));
  }
  return false;
}

// The index just past the template literal opening at `start`. A `${ … }` substitution is code: it may hold strings,
// braces and templates of its own (escaped backticks included), so the template ends only at a backtick outside them.
function templateEnd(text, start) {
  const n = text.length;
  let j = start + 1;
  while (j < n) {
    const c = text[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "`") return j + 1;
    if (c === "$" && text[j + 1] === "{") {
      let depth = 1;
      j += 2;
      while (j < n && depth > 0) {
        const d = text[j];
        if (d === "`") { j = templateEnd(text, j); continue; }
        if (d === '"' || d === "'") {
          let k = j + 1;
          while (k < n && text[k] !== d && text[k] !== "\n") k += text[k] === "\\" ? 2 : 1;
          j = k + 1;
          continue;
        }
        if (d === "{") depth++;
        else if (d === "}") depth--;
        j++;
      }
      continue;
    }
    j++;
  }
  return n;
}

export function maskLiteralsAndComments(text) {
  const out = text.split("");
  let i = 0;
  const n = text.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      let j = i;
      while (j < n && text[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (ch === "/" && next === "*") {
      let j = text.indexOf("*/", i + 2);
      j = j === -1 ? n : j + 2;
      blank(i, j);
      i = j;
    } else if (ch === "/" && regexMayStart(text, i)) {
      // A regex literal, masked like a string: up to the unescaped `/` outside a character class, never past the line.
      let j = i + 1, inClass = false;
      while (j < n && text[j] !== "\n") {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "[") inClass = true;
        else if (text[j] === "]") inClass = false;
        else if (text[j] === "/" && !inClass) break;
        j++;
      }
      if (j >= n || text[j] !== "/") { i++; continue; }   // no closing slash on the line: not a regex
      blank(i + 1, j);
      i = j + 1;
    } else if (ch === "`") {
      const j = templateEnd(text, i);
      blank(i + 1, j - 1 >= i + 1 ? j - 1 : i + 1);
      i = j;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === ch) { j++; break; }
        j++;
      }
      blank(i + 1, j - 1 >= i + 1 ? j - 1 : i + 1);
      i = j;
    } else {
      i++;
    }
  }
  return out.join("");
}

// A check reports RAW facts and exits 0 even when it finds violations: finding a
// violation is not a run error, and the disposition verdict is the consumer's.
export function emit(violations) {
  const reportPath = process.env.ATDD_VIOLATIONS_REPORT;
  if (!reportPath) {
    process.stderr.write("bun-detector: ATDD_VIOLATIONS_REPORT not set\n");
    process.exit(2);
  }
  writeFileSync(reportPath, JSON.stringify({ violations }, null, 2), "utf8");
  process.exit(0);
}

export function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// Turn a character offset into the {line, col, source_line} the v1.1 record needs.
export function locate(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEnd = text.indexOf("\n", offset);
  return {
    line,
    col: offset - lineStart + 1,
    source_line: text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim(),
  };
}

// Walk for files matched by BASENAME rather than extension — the shape a
// repo-hygiene rule needs (lockfiles, config files), where the filename itself is
// the fact being checked.
export function* walkByName(root, excludes, names) {
  let st;
  try {
    st = statSync(root);
  } catch {
    return;
  }
  if (st.isFile()) return;
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(root, name);
    if (isExcluded(full, excludes)) continue;
    let cst;
    try {
      cst = statSync(full);
    } catch {
      continue;
    }
    if (cst.isDirectory()) yield* walkByName(full, excludes, names);
    else if (names.has(name)) yield full;
  }
}

// Return the full source text of the markup tag enclosing `offset`, or null.
// Attribute rules are per-ELEMENT ("this element carries hx-delete but no
// hx-confirm"), so a check must see the whole opening tag, not the one attribute
// it matched. Quote-aware so a `>` inside an attribute value does not end the tag.
export function enclosingTag(text, offset) {
  let start = -1;
  for (let i = offset; i >= 0; i--) {
    if (text[i] === "<") { start = i; break; }
    if (text[i] === ">") return null; // ran out of the tag before finding its open
  }
  if (start === -1) return null;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return { start, end: i + 1, text: text.slice(start, i + 1) };
    }
  }
  return null;
}

// Extract every backtick template literal as {start, text}. Used by the fragment
// escaping rule: in a full-stack Bun app the HTML fragments htmx swaps in are
// built as tagged/plain template literals, so THAT is where the injection risk
// lives — and it is precisely what `maskLiteralsAndComments` blanks, hence a
// dedicated extractor rather than reusing the mask.
export function templateLiterals(text) {
  const found = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`") {
      const start = i;
      let j = i + 1;
      let depth = 0;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "$" && text[j + 1] === "{") { depth++; j += 2; continue; }
        if (text[j] === "}" && depth > 0) { depth--; j++; continue; }
        if (text[j] === "`" && depth === 0) break;
        j++;
      }
      found.push({ start, text: text.slice(start, Math.min(j + 1, text.length)) });
      i = j + 1;
    } else {
      i++;
    }
  }
  return found;
}

// Blank line comments and block comments with spaces, preserving every line and
// column offset — but KEEP string literals. maskLiteralsAndComments is for checks
// that must not fire on rule prose inside strings; this is for checks whose payload
// IS the string (telemetry identities passed to emit-like calls).
export function maskComments(text) {
  const out = text.split("");
  const blank = (from, to) => {
    for (let k = from; k < to && k < text.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i], next = text[i + 1];
    if (ch === "/" && next === "/") {
      let j = i;
      while (j < text.length && text[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (ch === "/" && next === "*") {
      let j = text.indexOf("*/", i + 2);
      j = j === -1 ? text.length : j + 2;
      blank(i, j);
      i = j;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === ch || text[j] === "\n") break;
        j++;
      }
      i = text[j] === ch ? j + 1 : j;
    } else {
      i++;
    }
  }
  return out.join("");
}
