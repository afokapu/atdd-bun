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
function lineOf(content, token) { return content.slice(0, content.indexOf(token)).split("\n").length; }

for (const root of roots) {
  const topology = await topologyFor(root), planPrefix = topology.planRoot.replace(/\/$/, "") + "/"; planDisplay = planPrefix;
  walk(root, (path) => {
    const name = path.split("/").pop() || "";
    const content = text(path);
    if (/\.ya?ml$/i.test(name) && relative(root, path).replaceAll("\\", "/").startsWith(planPrefix)) {
      for (const [kind, re] of Object.entries({
        acc: /\bacc:[A-Za-z0-9_.:-]+/g,
        wmbt: /\bwmbt:[A-Za-z0-9_.:-]+/g,
        train: /\btrain:[A-Za-z0-9_.:-]+/g,
      })) for (const match of content.matchAll(re)) plans[kind].add(match[0]);
      return;
    }
    if (!sourceExtensions.has(name.slice(name.lastIndexOf(".")))) return;
    const head = content.split("\n").slice(0, 40).join("\n");
    if (testName.test(name)) {
      const urn = head.match(/^\s*\/\/\s*URN:\s*(test:[^\s]+)/m);
      if (!urn) return;
      // EVERY binding header is judged, not only the first: a valid Acceptance: must not carry an unresolved Train:.
      const headers = [...head.matchAll(/^\s*\/\/\s*(Acceptance|WMBT|Train):[ \t]*(\S*)/gm)].map((match) => ({ kind: match[1], id: match[2], raw: match[0].trim() }));
      const bindings = headers.filter((h) => h.id.startsWith({ Acceptance: "acc:", WMBT: "wmbt:", Train: "train:" }[h.kind]));
      tests.set(urn[1], { path, bindings });
      if (!headers.length) add("traceability.test.binding-resolves", path, lineOf(head, urn[0]), "test has a URN but no Acceptance:, WMBT:, or Train: binding", urn[0]);
      for (const h of headers) if (!bindings.includes(h)) add("traceability.test.binding-resolves", path, lineOf(head, h.raw), `${h.kind}: ${h.id || "<empty>"} is not a ${h.kind === "Acceptance" ? "acc" : h.kind.toLowerCase()}: identity`, h.raw);
      return;
    }
    const component = head.match(/^\s*\/\/\s*URN:\s*(component:[^\s]+)/m);
    if (!component) return;
    // Only list entries directly under a `// Tested-By:` header count, and EVERY one of them is judged: a
    // malformed `- not-a-test` after a valid entry fails too. A stray list item elsewhere declares nothing.
    const lines = head.split("\n"), header = lines.findIndex((line) => /^\s*\/\/\s*Tested-By:\s*$/.test(line)), testedBy = [];
    if (header !== -1) for (const line of lines.slice(header + 1)) { const entry = line.match(/^\s*\/\/\s*-\s*(\S*)/); if (!entry) break; testedBy.push(entry[1] || "<empty>"); }
    sources.push({ path, head, component: component[1], testedBy });
  });
}

for (const test of tests.values()) for (const binding of test.bindings) {
  if (!plans[binding.id.split(":", 1)[0]].has(binding.id)) add("traceability.test.binding-resolves", test.path, lineOf(text(test.path), binding.raw), `${binding.id} is not declared in plan/`, binding.raw);
}
const boundAcceptances = new Set([...tests.values()].flatMap((test) => test.bindings.map((binding) => binding.id)).filter((id) => id.startsWith("acc:")));
for (const acceptance of plans.acc) {
  if (!boundAcceptances.has(acceptance)) add("traceability.plan.executable-acceptance-has-test", planDisplay, 1, `${acceptance} has no Bun test binding`, acceptance);
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
