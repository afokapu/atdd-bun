// test_header.mjs — shared parser + walk + runCheck for the TESTER discipline
// family. Lives at the implementation ROOT (imported by checks via
// `../test_header.mjs`); the family runner only spawns `checks/*.mjs`.
//
// A TEST file's header is a different document from a SOURCE file's. Source
// declares what it IS (URN / Tested-By / Runtime / Purpose — see urn_header.mjs);
// a test declares what it PROVES:
//
//     // URN: test:{wagon}:{feature}:{ACCEPTANCE-ID}
//     // Acceptance: acc:{wagon}:{ACCEPTANCE-ID}
//     // WMBT: wmbt:{wagon}:{CODE}
//     // Phase: RED | UNIT | SMOKE | E2E
//     // Layer: domain | application | integration | presentation | assembly
//
// That is the shape core uses (1,057 `# Acceptance:` headers in the atdd repo
// itself), transcribed to `//` for this stack. Core's own
// `tester.filename.test-carries-urn-identity` is explicit that the HEADER, not the
// filename, is authoritative — so this family never parses filenames for identity.
//
// PER-`it()` COVERAGE TAGS. The file header binds a file to its acceptances; a
// `// @covers acc:…` comment above an individual `it()` binds at test-case
// granularity. That two-level model is what issue #1783 argued for against a
// per-file rename: one spec file is wagon-level and legitimately covers many
// acceptances, so a one-acceptance-per-file naming rule would fragment a real
// suite. Both levels are parsed here.
import { readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname, sep } from "node:path";

export const DEFAULT_EXCLUDES = ["node_modules", "dist", "build", ".next", ".git", "_generated"];
export const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
export const PHASES = new Set(["RED", "UNIT", "SMOKE", "E2E"]);
export const LAYERS = new Set(["domain", "application", "integration", "presentation", "assembly"]);

export function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fallback;
  } catch { return fallback; }
}

function isExcluded(path, excludes) {
  const segs = path.split(sep);
  return excludes.some((ex) => segs.includes(ex) || path.includes(ex));
}

// Walks TEST FILES ONLY. The tester persona governs the suite; source files are
// the coder extension's business, and scanning them here would double-report.
export function* walkTests(root, excludes) {
  let st;
  try { st = statSync(root); } catch { return; }
  if (st.isFile()) { if (TEST_RE.test(root)) yield root; return; }
  let names;
  try { names = readdirSync(root); } catch { return; }
  for (const name of names) {
    const full = join(root, name);
    if (isExcluded(full, excludes)) continue;
    let cst;
    try { cst = statSync(full); } catch { continue; }
    if (cst.isDirectory()) yield* walkTests(full, excludes);
    else if (TEST_RE.test(full)) yield full;
  }
}

export function parseHeader(text) {
  const lines = text.split(/\r?\n/);
  let firstMeaningful = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "" || t.startsWith("#!")) continue;
    firstMeaningful = i; break;
  }
  const H = {
    lines,
    firstMeaningfulNo: firstMeaningful >= 0 ? firstMeaningful + 1 : 0,
    firstMeaningfulText: firstMeaningful >= 0 ? lines[firstMeaningful].trim() : "",
    urn: null, acceptance: null, wmbt: null, train: null, phase: null, layer: null,
    runtime: null,
  };
  const FIELDS = [["URN", "urn"], ["Acceptance", "acceptance"], ["WMBT", "wmbt"],
                  ["Train", "train"], ["Phase", "phase"], ["Layer", "layer"],
                  ["Runtime", "runtime"]];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t === "" || t.startsWith("#!")) continue;
    if (!t.startsWith("//")) break;          // first real code line ends the header
    const body = t.slice(2).trim();
    for (const [label, key] of FIELDS) {
      if (H[key]) continue;
      const m = body.match(new RegExp(`^${label}:\\s*(\\S.*?)\\s*$`));
      if (m) { H[key] = { no: i + 1, value: m[1], raw: t }; break; }
    }
  }
  return H;
}

// Every `it(...)` / `test(...)` call, with the `// @covers …` tags attached in the
// comment block immediately above it.
export function testCases(text) {
  const lines = text.split(/\r?\n/);
  const cases = [];
  const CASE_RE = /^\s*(?:it|test)(?:\.\w+)*\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    if (!CASE_RE.test(lines[i])) continue;
    const covers = [];
    for (let j = i - 1; j >= 0; j--) {
      const t = lines[j].trim();
      if (t === "") continue;
      if (!t.startsWith("//")) break;
      const m = t.match(/^\/\/\s*@covers\s+(.*)$/);
      if (m) covers.push(...m[1].split(/\s+/).filter(Boolean));
    }
    cases.push({ line: i + 1, text: lines[i].trim(), covers });
  }
  return cases;
}

// The body of the `it()` at `startLine`, by brace matching from its opening `{`.
export function caseBody(text, startLine) {
  const lines = text.split(/\r?\n/);
  const offset = lines.slice(0, startLine - 1).join("\n").length + (startLine > 1 ? 1 : 0);
  const open = text.indexOf("{", offset);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return text.slice(open, i + 1); }
  }
  return text.slice(open);
}

export function runCheck(ruleId, evaluate) {
  const reportPath = process.env.ATDD_VIOLATIONS_REPORT;
  if (!reportPath) {
    process.stderr.write("tester-check: ATDD_VIOLATIONS_REPORT not set\n");
    process.exit(2);
  }
  const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
  const excludes = [...DEFAULT_EXCLUDES, ...parseJsonEnv("ATDD_SCAN_EXCLUDES", [])];
  const violations = [];
  for (const root of roots) {
    for (const file of walkTests(root, excludes)) {
      let text;
      try { text = readFileSync(file, "utf8"); } catch { continue; }
      const found = evaluate(parseHeader(text), file, text) || [];
      for (const r of (Array.isArray(found) ? found : [found])) {
        if (!r) continue;
        violations.push({
          rule_id: ruleId, file, line: r.line, col: r.col ?? 1,
          evidence: r.evidence, source_line: r.source_line ?? "",
        });
      }
    }
  }
  writeFileSync(reportPath, JSON.stringify({ violations }, null, 2), "utf8");
  process.stderr.write(`tester-check ${ruleId}: ${violations.length} violation(s)\n`);
  process.exit(0);
}
