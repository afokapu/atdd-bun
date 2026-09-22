#!/usr/bin/env bun
// Bun-native closure gate for plan -> test -> implementation traceability.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

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
  walk(root, (path) => {
    const name = path.split("/").pop() || "";
    const content = text(path);
    if (/\.ya?ml$/i.test(name) && /(?:^|\/)plan(?:\/|$)/.test(path)) {
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
      const binding = head.match(/^\s*\/\/\s*(Acceptance|WMBT|Train):\s*((?:acc|wmbt|train):[^\s]+)/m);
      if (!urn) return;
      tests.set(urn[1], { path, binding: binding?.[2], bindingKind: binding?.[1] });
      if (!binding) add("traceability.test.binding-resolves", path, lineOf(head, urn[0]), "test has a URN but no Acceptance:, WMBT:, or Train: binding", urn[0]);
      return;
    }
    const component = head.match(/^\s*\/\/\s*URN:\s*(component:[^\s]+)/m);
    if (!component) return;
    const testedBy = [...head.matchAll(/^\s*\/\/\s*-\s*(test:[^\s]+)/gm)].map((match) => match[1]);
    sources.push({ path, head, component: component[1], testedBy });
  });
}

for (const test of tests.values()) {
  if (!test.binding) continue;
  const kind = test.binding.startsWith("acc:") ? "acc" : test.binding.startsWith("wmbt:") ? "wmbt" : "train";
  if (!plans[kind].has(test.binding)) {
    add("traceability.test.binding-resolves", test.path, lineOf(text(test.path), test.binding), `${test.binding} is not declared in plan/`, `// ${test.bindingKind}: ${test.binding}`);
  }
}
const boundAcceptances = new Set([...tests.values()].map((test) => test.binding).filter((id) => id?.startsWith("acc:")));
for (const acceptance of plans.acc) {
  if (!boundAcceptances.has(acceptance)) add("traceability.plan.executable-acceptance-has-test", "plan/", 1, `${acceptance} has no Bun test binding`, acceptance);
}
for (const source of sources) {
  if (!source.testedBy.length) {
    add("traceability.source.tested-by-present", source.path, lineOf(source.head, source.component), `${source.component} has no Tested-By: test:... declaration`, source.component);
    continue;
  }
  for (const testUrn of source.testedBy) {
    if (!tests.has(testUrn)) add("traceability.source.tested-by-resolves", source.path, lineOf(source.head, testUrn), `${testUrn} does not resolve to a Bun test`, testUrn);
  }
}
writeFileSync(report, JSON.stringify({ violations }, null, 2));
