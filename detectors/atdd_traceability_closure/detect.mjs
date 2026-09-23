#!/usr/bin/env bun
// Bun-native closure gate for plan -> test -> implementation traceability.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { topologyFor } from "../../src/topology.ts";
import { loadLifecycle, isPlannedAcceptance } from "../../src/lifecycle.ts";

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
// Staged activation (src/lifecycle.ts): the lifecycle of every scanned root, merged.
const lifecycle = { declared: false, features: [], trains: [], acceptances: [] };

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
  const local = await loadLifecycle(root);
  lifecycle.declared ||= local.declared;
  for (const key of ["features", "trains", "acceptances"]) lifecycle[key].push(...local[key].map((item) => ({ ...item, file: join(root, item.file) })));
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
    // Only `- test:` entries directly under a `// Tested-By:` header count; a stray list item declares nothing.
    const lines = head.split("\n"), header = lines.findIndex((line) => /^\s*\/\/\s*Tested-By:\s*$/.test(line)), testedBy = [];
    if (header !== -1) for (const line of lines.slice(header + 1)) { const entry = line.match(/^\s*\/\/\s*-\s*(test:[^\s]+)/); if (!entry) break; testedBy.push(entry[1]); }
    sources.push({ path, head, component: component[1], testedBy });
  });
}

for (const test of tests.values()) for (const binding of test.bindings) {
  const kind = binding.id.split(":", 1)[0];
  if (!plans[kind].has(binding.id)) add("traceability.test.binding-resolves", test.path, lineOf(text(test.path), binding.raw), `${binding.id} is not declared in plan/`, binding.raw);
}
const bound = (prefix) => new Set([...tests.values()].flatMap((test) => test.bindings.map((binding) => binding.id)).filter((id) => id.startsWith(prefix)));
const boundAcceptances = bound("acc:");
// A planned feature's acceptances are planned debt: not executable yet, so not closure violations. They are
// counted by `atdd-bun lifecycle`. Every other acceptance (a tested/implemented feature's, or one with no
// declared lifecycle at all) must be bound.
for (const acceptance of plans.acc) {
  if (!boundAcceptances.has(acceptance) && !isPlannedAcceptance(lifecycle, acceptance)) add("traceability.plan.executable-acceptance-has-test", planDisplay, 1, `${acceptance} has no Bun test binding`, acceptance);
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
const statusLine = (path) => { const content = text(path), match = content.match(/^status:.*$/m); return match ? { line: lineOf(content, match[0]), source: match[0] } : { line: 1, source: "" }; };
for (const item of [...lifecycle.features, ...lifecycle.trains]) if (item.invalidStatus !== undefined) {
  const at = statusLine(item.file);
  add("traceability.lifecycle.status-valid", item.file, at.line, `${item.urn ?? item.id} has status "${item.invalidStatus}"; the lifecycle is planned | tested | implemented`, at.source);
}
// Ownership decides whether an acceptance is planned or executable, so once a plan declares any status an
// acceptance whose WMBT is listed by more than one feature has no single lifecycle and is rejected.
if (lifecycle.declared) for (const acceptance of lifecycle.acceptances) if (acceptance.owners.length > 1) {
  add("traceability.lifecycle.acceptance-single-owner", acceptance.file, lineOf(text(acceptance.file), acceptance.acceptance), `${acceptance.acceptance} (${acceptance.wmbt}) is owned by ${acceptance.owners.join(", ")}; exactly one feature must own it`, acceptance.acceptance);
}
// A planned feature may already carry partial source: status never exempts it, because every component's
// Tested-By above stays strict whatever the feature's status. An implemented feature needs some source.
const featureOf = (component) => { const [, wagon, slug] = component.split(":"); return `feature:${wagon}:${slug}`; };
const claimed = new Set(sources.map((source) => featureOf(source.component)));
for (const feature of lifecycle.features) if (feature.status === "implemented" && !claimed.has(feature.urn)) {
  const at = statusLine(feature.file);
  add("traceability.lifecycle.implemented-feature-has-source", feature.file, at.line, `${feature.urn} is implemented but no source declares \`// URN: component:${feature.wagon}:${feature.slug}:...\``, at.source);
}
// A planned train needs no end-to-end binding yet; a tested or implemented one does.
const boundTrains = bound("train:");
for (const train of lifecycle.trains) if ((train.status === "tested" || train.status === "implemented") && !boundTrains.has(train.id)) {
  const at = statusLine(train.file);
  add("traceability.train.executable-train-has-test", train.file, at.line, `${train.id} is ${train.status} but no Bun test declares \`// Train: ${train.id}\``, at.source);
}
writeFileSync(report, JSON.stringify({ violations }, null, 2));
