#!/usr/bin/env bun
// Member check: coder.htmx.verb-endpoint-is-routed  (htmx hypermedia family)
//
// A MUTATING htmx endpoint must be served by the Station Master surface.
//
// This stack's own convention says "an htmx endpoint is declared in the MARKUP, so the
// markup is this stack's route space" (tester.htmx.verb-endpoint-coverage). That is
// right, and it is also why the markup can mint a route space nobody planned. Measured:
// an `hx-post="/orders/void-all"` carrying a confirm, an indicator and a passing test,
// bound to no wagon, train or interlocking, passed EVERY gated bun+htmx rule. The button
// posts into nothing.
//
// That is the parallel-route-space shape this hub already rejects elsewhere — the
// interlocking families fail a consumer that declares reachability in a second, private
// field instead of the declared one. htmx had the same hole with none of the teeth.
//
// MUTATIONS ONLY, DELIBERATELY. hx-get fetches a fragment: that is presentation, and
// requiring every read to be routed by the Station Master would fail ordinary htmx.
// hx-post / hx-put / hx-patch / hx-delete ADVANCE STATE, which is what a journey does,
// so those are the ones that owe a route.
//
// STATIC PATHS ONLY. An endpoint built by interpolation (`/orders/${id}/void`) cannot be
// compared to a server route by text, and guessing would report on correct code. Those
// are skipped, exactly as the Vite family treats an unresolvable trainId as advisory
// rather than inventing a verdict.
//
// NOT_APPLICABLE when no Station Master surface resolves: a consumer with no JOURNEY_MAP
// has no journey space to be outside of.
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations to
// ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RULE = "coder.htmx.verb-endpoint-is-routed";
const EXCLUDES = ["node_modules", "dist", "build", ".next", ".git", "_generated"];
const SRC = /\.(ts|tsx|js|jsx|mjs|html)$/;
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
// A mutating verb bound to a STATIC path — no `${...}` interpolation.
const MUTATING = /\bhx-(post|put|patch|delete)\s*=\s*"([^"${}]+)"/g;

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

function parseJsonEnv(name, fallback) {
  try { const v = JSON.parse(process.env[name] || ""); return Array.isArray(v) ? v : fallback; }
  catch { return fallback; }
}

function walk(dir, excludes) {
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
      else out.push(full);
    }
  })(dir);
  return out;
}

// Comments masked so a path MENTIONED in prose cannot stand in for a served route.
export function maskComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

// The Station Master is the module DECLARING a JOURNEY_MAP — found by that claim, not by
// filename, matching how the interlocking binding family locates it.
export function stationMasterText(files) {
  const parts = [];
  for (const f of files) {
    const t = read(f);
    if (/\bJOURNEY_MAP\b/.test(t)) parts.push(maskComments(t));
  }
  return parts.length ? parts.join("\n") : null;
}

const reportPath = process.env.ATDD_VIOLATIONS_REPORT;
if (!reportPath) {
  process.stderr.write("htmx-check: ATDD_VIOLATIONS_REPORT not set\n");
  process.exit(2);
}
const excludes = [...EXCLUDES, ...parseJsonEnv("ATDD_SCAN_EXCLUDES", [])];
const violations = [];

for (const root of parseJsonEnv("ATDD_SCAN_ROOTS", [])) {
  const all = walk(root, excludes).filter((f) => SRC.test(f) && !TEST.test(f));
  // Group by CONSUMER ROOT — the directory holding the Station Master — rather than
  // judging a whole scan root at once. A scan root can hold several independent
  // projects (this workspace's fixture trees do), and one project's JOURNEY_MAP must
  // not be used to judge another's endpoints.
  const stations = all.filter((f) => /\bJOURNEY_MAP\b/.test(read(f)));
  if (!stations.length) continue;              // no journey space to be outside of

  for (const stationFile of stations) {
    const croot = stationFile.slice(0, stationFile.lastIndexOf("/"));
    const station = maskComments(read(stationFile));
    const files = all.filter((f) => f.startsWith(croot + "/"));

  for (const file of files) {
    const text = read(file);
    for (const m of text.matchAll(MUTATING)) {
      const [, verb, path] = m;
      // Served if the Station Master names the whole path, or its DISTINCTIVE terminal
      // segment — a pattern router rarely repeats a literal path, but it does name the
      // action it dispatches. Matching on any segment was the first attempt and made the
      // rule vacuous: the Station Master imports from ./src/orders/, so "orders" matched
      // and every /orders/* endpoint was treated as routed.
      const segments = path.split("/").filter(Boolean).filter((s) => !/^[:{]|^\d+$/.test(s));
      const terminal = segments[segments.length - 1];
      const named = station.includes(path) || (terminal && station.includes(terminal));
      if (named) continue;
      const line = text.slice(0, m.index).split(/\r?\n/).length;
      violations.push({
        rule_id: RULE, file, line, col: 1,
        evidence:
          `hx-${verb}="${path}" advances state but the Station Master surface routes nothing ` +
          `matching it; the markup declares a route space the journey space never admitted`,
        source_line: (text.split(/\r?\n/)[line - 1] || "").trim(),
      });
    }
  }
  }
}
writeFileSync(reportPath, JSON.stringify({ violations }, null, 2), "utf8");
process.stderr.write(`htmx[verb-endpoint-is-routed]: ${violations.length} violation(s)\n`);
process.exit(0);
