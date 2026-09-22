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
import { join, extname, sep } from "node:path";

// Build output and vendored trees are never source-under-inspection. `.atdd` is
// excluded by the adapter, not here, because a consumer's `.atdd/config.yaml` is
// legitimate input for config-reading checks.
export const DEFAULT_EXCLUDES = ["node_modules", "dist", "build", ".next", ".git", "_generated"];

// Bun runs TS and ESM natively, so a full-stack Bun repo's source surface is
// exactly these; `.html` is included because htmx templates ARE the source.
export const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);
export const TEMPLATE_EXT = new Set([".html", ".htm"]);
export const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

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

function isExcluded(path, excludes) {
  const segments = path.split(sep);
  return excludes.some((ex) => segments.includes(ex) || path.includes(ex));
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
    if (exts.has(extname(root)) && (includeTests || !TEST_RE.test(root))) yield root;
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
    } else if (exts.has(extname(full)) && (includeTests || !TEST_RE.test(full))) {
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
    } else if (ch === '"' || ch === "'" || ch === "`") {
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
