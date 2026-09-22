// urn_header.mjs — zero-dependency shared header parser + runCheck helper for the
// GREEN/URN traceability family. Lives at the implementation ROOT (imported by
// checks via `../urn_header.mjs`); the family runner only spawns `checks/*.mjs`,
// so this module is never run as a member.
//
// THE OBLIGATION IS STACK-NEUTRAL. Every implementation file carries a
// traceability header binding it to the plan graph:
//
//     URN: component:{wagon}:{feature}:{Name}:{side}:{layer}   <- first real line
//     Tested-By:
//     - test:{wagon}:{feature}:{ACCEPTANCE-ID}
//     Runtime: {bun|browser|isomorphic}
//     Purpose: <= 80 chars
//
// Python writes it with `#`, Vite/React with `//`. Only the COMMENT SYNTAX is
// per-stack; the keywords, the six-segment URN and the order are the same
// obligation in all three. This file is the Bun realization of that parser.
//
// TWO STACK ADAPTATIONS, both load-bearing:
//
//   1. HTML TEMPLATES ARE IMPLEMENTATION. htmx deliberately moves behaviour INTO
//      markup — an `hx-post` on a button IS the request, and a fragment IS the
//      response. A traceability layer that only read `.ts` would therefore leave
//      the behavioural half of an htmx app entirely unbound to the plan graph.
//      So `.html`/`.htm` are first-class here and carry `<!-- URN: ... -->`.
//      This is the one place the Bun mirror is genuinely wider than the Vite one.
//
//   2. THE HEADER MAY FOLLOW A SHEBANG OR DOCTYPE. A Bun entrypoint often opens
//      `#!/usr/bin/env bun`, and an HTML document opens `<!doctype html>`. Neither
//      is content, so neither may displace the URN from "first real line" — the
//      Vite parser counts a shebang as the first non-empty line and fails such a
//      file for a header it actually has. `firstMeaningfulNo` skips both.
import { readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname, sep } from "node:path";

export const DEFAULT_EXCLUDES = ["_generated", "node_modules", "dist", "build", ".next", ".git"];
export const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);
export const TEMPLATE_EXT = new Set([".html", ".htm"]);
export const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

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

export function isExcluded(path, excludes) {
  const segs = path.split(sep);
  return excludes.some((ex) => segs.includes(ex) || path.includes(ex));
}

function isScannable(file) {
  const ext = extname(file);
  return (SOURCE_EXT.has(ext) || TEMPLATE_EXT.has(ext)) && !TEST_RE.test(file);
}

export function* walk(root, excludes) {
  let st;
  try {
    st = statSync(root);
  } catch {
    return; // a missing scan root is not a fault — skip silently
  }
  if (st.isFile()) {
    if (isScannable(root)) yield root;
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
    if (cst.isDirectory()) yield* walk(full, excludes);
    else if (isScannable(full)) yield full;
  }
}

// Strip one line's comment wrapper, or return null when the line is not a
// single-line comment in this file's syntax. HTML uses `<!-- … -->`; everything
// else uses `//`.
function uncomment(line, isTemplate) {
  const t = line.trim();
  if (isTemplate) {
    const m = t.match(/^<!--\s*(.*?)\s*-->$/);
    return m ? m[1] : null;
  }
  return t.startsWith("//") ? t.slice(2).trim() : null;
}

// A line that precedes the header without being content: a JS shebang or an HTML
// doctype. Skipped when locating the "first meaningful line", so a header that
// legitimately follows one is not reported as missing.
function isPreamble(line, isTemplate) {
  const t = line.trim();
  return isTemplate ? /^<!doctype\s/i.test(t) : t.startsWith("#!");
}

// Parse the leading traceability header. The header REGION is the leading run of
// blank lines, an optional preamble, and single-line comments; the first real
// content line ends it. Markers are recognised ONLY inside that region, so a
// header pushed below the imports reads as "missing" — which is exactly what the
// marker rule is meant to flag.
export function parseHeader(text, file) {
  const isTemplate = TEMPLATE_EXT.has(extname(file || ""));
  const lines = text.split(/\r?\n/);

  let firstMeaningful = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "" || isPreamble(lines[i], isTemplate)) continue;
    firstMeaningful = i;
    break;
  }

  const H = {
    lines,
    isTemplate,
    firstMeaningfulNo: firstMeaningful >= 0 ? firstMeaningful + 1 : 0,
    firstMeaningfulText: firstMeaningful >= 0 ? lines[firstMeaningful].trim() : "",
    urn: null, segs: null, runtime: null, purpose: null, testedBy: null, testedEntries: 0,
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;                 // blanks do not end the region
    if (isPreamble(raw, isTemplate)) continue;
    const body = uncomment(raw, isTemplate);
    if (body === null) break;                        // first real content line
    let m;
    if (!H.urn && (m = body.match(/^URN:\s*(\S.*?)\s*$/))) {
      H.urn = { no: i + 1, col: raw.search(/\S/) + 1, value: m[1], raw: raw.trim() };
      H.segs = m[1].split(":");
    } else if (!H.runtime && (m = body.match(/^Runtime:\s*(\S.*?)\s*$/))) {
      H.runtime = { no: i + 1, value: m[1], raw: raw.trim() };
    } else if (!H.purpose && (m = body.match(/^Purpose:\s*(\S.*?)\s*$/))) {
      H.purpose = { no: i + 1, value: m[1], raw: raw.trim() };
    } else if (!H.testedBy && /^Tested-By:\s*$/.test(body)) {
      H.testedBy = { no: i + 1 };
    } else if (/^-\s*test:\S/.test(body)) {
      H.testedEntries++;
    }
  }
  return H;
}

// Boilerplate shared by every member: read the env channel, walk the scan roots,
// parse each file's header, call `evaluate(H, file)` -> violation record | null,
// write the RAW v1.1 report, exit 0 (run-health, never a verdict).
export function runCheck(ruleId, evaluate) {
  const reportPath = process.env.ATDD_VIOLATIONS_REPORT;
  if (!reportPath) {
    process.stderr.write("green-check: ATDD_VIOLATIONS_REPORT not set\n");
    process.exit(2);
  }
  const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
  const excludes = [...DEFAULT_EXCLUDES, ...parseJsonEnv("ATDD_SCAN_EXCLUDES", [])];
  const violations = [];
  for (const root of roots) {
    for (const file of walk(root, excludes)) {
      let text;
      try { text = readFileSync(file, "utf8"); } catch { continue; }
      const r = evaluate(parseHeader(text, file), file);
      if (!r) continue;
      violations.push({
        rule_id: ruleId,
        file,
        line: r.line,
        col: r.col ?? 1,
        evidence: r.evidence,
        source_line: r.source_line ?? "",
      });
    }
  }
  writeFileSync(reportPath, JSON.stringify({ violations }, null, 2), "utf8");
  process.stderr.write(`green-check ${ruleId}: ${violations.length} violation(s)\n`);
  process.exit(0);
}
