#!/usr/bin/env bun
// Bun-native closure gate for plan -> test -> implementation traceability.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { topologyFor } from "../../src/topology.ts";

const roots = JSON.parse(process.env.ATDD_SCAN_ROOTS || "[]");
const excludes = new Set(JSON.parse(process.env.ATDD_SCAN_EXCLUDES || "[]"));
const report = process.env.ATDD_VIOLATIONS_REPORT;
if (!report || !Array.isArray(roots) || !roots.length) process.exit(2);

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const testName = /(?:^test_.*|.*(?:\.test|\.spec|_test))\.(?:[cm]?[jt]sx?)$/;
const violations = [];
const plans = { acc: new Set(), wmbt: new Set(), train: new Set() };
const tests = new Map();
const declaredAt = new Map();
const sources = [];
let planDisplay = "plan/";

function ignored(path) {
  return [...excludes].some((needle) => path.includes(needle));
}
function walk(dir, file) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (ignored(full)) continue;
    if (entry.isDirectory()) walk(full, file); else file(full);
  }
}
function text(path) { try { return readFileSync(path, "utf8"); } catch { return ""; } }
function add(rule_id, file, line, evidence, source_line = "") {
  violations.push({ rule_id, file, line, col: 1, evidence, source_line });
}
function lineOf(content, token) { return lineAt(content, content.indexOf(token)); }
function lineAt(content, index) { return content.slice(0, index).split("\n").length; }
// The identity each binding header must carry.
const PREFIX = { Acceptance: "acc:", WMBT: "wmbt:", Train: "train:" };

for (const root of roots) {
  // `plan_root: .` (or `./`) must still match root-relative paths, which never start with `./`.
  const topology = await topologyFor(root), planDir = topology.planRoot.replace(/^\.(?:\/|$)/, "").replace(/\/$/, ""), planPrefix = planDir ? planDir + "/" : ""; planDisplay = planPrefix || "./";
  walk(root, (path) => {
    const name = path.split("/").pop() || "";
    const content = text(path);
    if (/\.ya?ml$/i.test(name) && relative(root, path).replaceAll("\\", "/").startsWith(planPrefix)) {
      for (const [kind, re] of Object.entries({
        acc: /\bacc:[A-Za-z0-9_.:-]+/g,
        wmbt: /\bwmbt:[A-Za-z0-9_.:-]+/g,
        train: /\btrain:[A-Za-z0-9_.:-]+/g,
      })) for (const match of content.matchAll(re)) plans[kind].add(match[0]);
      // Where each acceptance is DECLARED (its `urn:` line), so a missing test is reported on the artifact to fix.
      for (const m of content.matchAll(/["']?\burn["']?[ \t]*:[ \t]*["']?(acc:[A-Za-z0-9_.:-]+)/g)) if (!declaredAt.has(m[1])) declaredAt.set(m[1], { path, line: lineAt(content, m.index) });
      return;
    }
    if (!sourceExtensions.has(name.slice(name.lastIndexOf(".")))) return;
    const head = content.split("\n").slice(0, 40).join("\n");
    if (testName.test(name)) {
      const urn = head.match(/^\s*\/\/\s*URN:\s*(test:[^\s]+)/m);
      if (!urn) return;
      // EVERY binding header is judged, not only the first: a valid Acceptance: must not carry an unresolved Train:.
      const headers = [...head.matchAll(/^[ \t]*\/\/[ \t]*(Acceptance|WMBT|Train):[ \t]*(\S*)/gm)].map((m) => ({ kind: m[1], id: m[2], raw: m[0].trim(), line: lineAt(head, m.index) }));
      const bindings = headers.filter((h) => h.id.startsWith(PREFIX[h.kind]));
      tests.set(urn[1], { path, bindings });
      if (!headers.length) add("traceability.test.binding-resolves", path, lineOf(head, urn[0]), "test has a URN but no Acceptance:, WMBT:, or Train: binding", urn[0]);
      for (const h of headers) if (!bindings.includes(h)) add("traceability.test.binding-resolves", path, h.line, `${h.kind}: ${h.id || "<empty>"} is not a ${PREFIX[h.kind]} identity`, h.raw);
      return;
    }
    const component = head.match(/^\s*\/\/\s*URN:\s*(component:[^\s]+)/m);
    if (!component) return;
    // Only list entries directly under a `// Tested-By:` header count, and EVERY one of them is judged: a
    // malformed `- not-a-test` after a valid entry fails too. A stray list item elsewhere declares nothing.
    const testedBy = [];
    let under = false;
    for (const line of head.split("\n")) {
      if (/^\s*\/\/\s*Tested-By:\s*$/.test(line)) { under = true; continue; }
      const entry = under && line.match(/^\s*\/\/\s*-\s*(\S*)/);
      if (entry) testedBy.push(entry[1] || "<empty>"); else under = false;
    }
    sources.push({ path, head, component: component[1], testedBy });
  });
}

for (const test of tests.values()) for (const binding of test.bindings) {
  if (!plans[binding.id.split(":", 1)[0]].has(binding.id)) add("traceability.test.binding-resolves", test.path, binding.line, `${binding.id} is not declared in plan/`, binding.raw);
}
const boundAcceptances = new Set([...tests.values()].flatMap((test) => test.bindings.map((binding) => binding.id)).filter((id) => id.startsWith("acc:")));
for (const acceptance of plans.acc) {
  const at = declaredAt.get(acceptance);
  if (!boundAcceptances.has(acceptance)) add("traceability.plan.executable-acceptance-has-test", at?.path ?? planDisplay, at?.line ?? 1, `${acceptance} has no Bun test binding`, acceptance);
}
for (const source of sources) {
  if (!source.testedBy.some((entry) => entry.startsWith("test:"))) {
    add("traceability.source.tested-by-present", source.path, lineOf(source.head, source.component), `${source.component} has no Tested-By: test:... declaration`, source.component);
    continue;
  }
  for (const testUrn of source.testedBy) {
    if (!tests.has(testUrn)) add("traceability.source.tested-by-resolves", source.path, lineOf(source.head, testUrn), testUrn.startsWith("test:") ? `${testUrn} does not resolve to a Bun test` : `Tested-By entry ${testUrn} is not a test: URN`, testUrn);
  }
}
writeFileSync(report, JSON.stringify({ violations }, null, 2));
