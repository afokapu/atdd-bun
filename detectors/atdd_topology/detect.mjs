#!/usr/bin/env bun
// Configurable plan/source/test/E2E topology and feature-decomposition gate.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const roots = JSON.parse(process.env.ATDD_SCAN_ROOTS || "[]"), report = process.env.ATDD_VIOLATIONS_REPORT;
if (!report) process.exit(2);
const defaults = { plan_root: "plan", source_root: "src/wagons", test_root: "tests/wagons", e2e_root: "e2e" };
const sourceExt = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cts", ".cjs", ".html", ".htm"]);
const testName = /(?:^test_.*|.*(?:\.test|\.spec|_test))\.(?:[cm]?[jt]sx?)$/;
const violations = [];
const rel = (root, path) => relative(root, path).split(sep).join("/");
const read = path => { try { return readFileSync(path, "utf8"); } catch { return ""; } };
const text = (data, key) => data && typeof data === "object" && !Array.isArray(data) && typeof data[key] === "string" ? data[key] : "";
const list = (data, key) => data && typeof data === "object" && Array.isArray(data[key]) ? data[key] : [];
const urns = values => values.map(value => typeof value === "string" ? value : text(value, "urn")).filter(Boolean);
function add(rule_id, root, path, evidence, line = 1, source_line = "") { violations.push({ rule_id, file: rel(root, path), line, col: 1, evidence, source_line }); }
function walk(dir, predicate, found = []) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (["node_modules", ".git", ".atdd", "dist", "build", ".next"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, predicate, found); else if (predicate(path)) found.push(path);
  }
  return found;
}
function topology(root) {
  let data = {}; try { data = Bun.YAML.parse(read(join(root, "atdd-bun.yaml"))) || {}; } catch {}
  const supplied = data && typeof data.topology === "object" && !Array.isArray(data.topology) ? data.topology : {};
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const value = supplied[key];
    if (typeof value === "string" && value && !value.startsWith("/") && !value.split(/[\\/]/).includes("..")) result[key] = value.replace(/\\/g, "/").replace(/\/$/, "");
  }
  return result;
}
function header(path) {
  const lines = read(path).split(/\r?\n/).slice(0, 60);
  const field = name => {
    const index = lines.findIndex(line => new RegExp(`^\\s*//\\s*${name}:\\s*(\\S.*?)\\s*$`).test(line));
    return index < 0 ? { value: "", line: 1, raw: "" } : { value: lines[index].replace(new RegExp(`^\\s*//\\s*${name}:\\s*`), "").trim(), line: index + 1, raw: lines[index].trim() };
  };
  return { urn: field("URN"), acceptance: field("Acceptance"), train: field("Train") };
}

for (const root of roots) {
  const cfg = topology(root), planRoot = join(root, cfg.plan_root), docs = [];
  for (const path of walk(planRoot, path => /\.ya?ml$/.test(path))) {
    try { const data = Bun.YAML.parse(read(path)); if (data && typeof data === "object" && !Array.isArray(data)) docs.push({ path, data }); } catch { /* schema validation owns parse errors */ }
  }
  const wagons = docs.filter(doc => text(doc.data, "urn").startsWith("wagon:")).map(doc => ({ ...doc, slug: text(doc.data, "urn").slice(6) }));
  const features = docs.filter(doc => text(doc.data, "urn").startsWith("feature:")).map(doc => { const [,, wagon, slug] = ["", ...text(doc.data, "urn").split(":")]; return { ...doc, wagon, slug, urn: text(doc.data, "urn") }; });
  const wmbts = docs.filter(doc => text(doc.data, "urn").startsWith("wmbt:")).map(doc => { const [, wagon, code] = text(doc.data, "urn").split(":"); return { ...doc, wagon, code, urn: text(doc.data, "urn") }; });
  const featureByUrn = new Map(features.map(feature => [feature.urn, feature])), memberships = new Map(), wmbtOwners = new Map();

  for (const wagon of wagons) {
    const expected = `${cfg.plan_root}/${wagon.slug}/_${wagon.slug}.yaml`;
    if (rel(root, wagon.path) !== expected) add("atdd-bun.topology.plan-location", root, wagon.path, `wagon:${wagon.slug} must be declared at ${expected}`);
    const declared = urns(list(wagon.data, "features"));
    if ((Number(wagon.data.wmbt?.total) > 0 || wmbts.some(wmbt => wmbt.wagon === wagon.slug)) && !declared.length) add("planner.wagon.features", root, wagon.path, `wagon:${wagon.slug} has WMBTs but no feature decomposition`);
    for (const urn of declared) {
      const feature = featureByUrn.get(urn);
      if (!feature) { add("planner.wagon.features", root, wagon.path, `wagon:${wagon.slug} lists ${urn}, but no feature document declares it`); continue; }
      memberships.set(urn, [...(memberships.get(urn) || []), wagon.slug]);
      if (feature.wagon !== wagon.slug || text(feature.data, "wagon") !== `wagon:${wagon.slug}`) add("planner.feature.wagon-link", root, feature.path, `${urn} must belong to wagon:${wagon.slug}`);
    }
  }
  for (const feature of features) {
    const expected = `${cfg.plan_root}/${feature.wagon}/${feature.slug}.yaml`, owners = memberships.get(feature.urn) || [];
    if (rel(root, feature.path) !== expected) add("atdd-bun.topology.plan-location", root, feature.path, `${feature.urn} must be declared at ${expected}`);
    if (owners.length !== 1) add("planner.feature.wagon-link", root, feature.path, `${feature.urn} must be listed by exactly one wagon; found ${owners.length}`);
    for (const urn of urns(list(feature.data, "wmbts"))) wmbtOwners.set(urn, [...(wmbtOwners.get(urn) || []), feature.urn]);
  }
  for (const wmbt of wmbts) {
    const expected = `${cfg.plan_root}/${wmbt.wagon}/${wmbt.code}.yaml`, owners = wmbtOwners.get(wmbt.urn) || [];
    if (rel(root, wmbt.path) !== expected) add("atdd-bun.topology.plan-location", root, wmbt.path, `${wmbt.urn} must be declared at ${expected}`);
    if (owners.length !== 1) add("planner.wagon.features", root, wmbt.path, `${wmbt.urn} must belong to exactly one feature; found ${owners.length}`);
  }

  const declaredFeatures = new Set(features.map(feature => `${feature.wagon}:${feature.slug}`));
  for (const path of walk(join(root, cfg.source_root), path => sourceExt.has(path.slice(path.lastIndexOf("."))) && !testName.test(path))) {
    const h = header(path), [, wagon, feature,,, layer] = h.urn.value.split(":"), expected = `${cfg.source_root}/${wagon}/features/${feature}/${layer === "integration" ? "infrastructure" : layer}/`;
    if (!wagon || !feature || !layer) add("atdd-bun.topology.source-location", root, path, "source requires URN: component:{wagon}:{feature}:{name}:{side}:{layer}", h.urn.line, h.urn.raw);
    else if (!rel(root, path).startsWith(expected)) add("atdd-bun.topology.source-location", root, path, `${h.urn.value} must live beneath ${expected}`, h.urn.line, h.urn.raw);
    if (wagon && feature && !declaredFeatures.has(`${wagon}:${feature}`)) add("planner.feature.wagon-link", root, path, `${h.urn.value} names undeclared feature:${wagon}:${feature}`, h.urn.line, h.urn.raw);
  }
  for (const path of walk(join(root, cfg.test_root), path => testName.test(path))) {
    const h = header(path), [, wagon, feature, acceptance] = h.urn.value.split(":"), expected = `${cfg.test_root}/${wagon}/features/${feature}/`;
    if (!wagon || !feature || !acceptance) add("atdd-bun.topology.test-location", root, path, "test requires URN: test:{wagon}:{feature}:{acceptance}", h.urn.line, h.urn.raw);
    else if (!rel(root, path).startsWith(expected) || !/(unit|contract|integration)\//.test(rel(root, path).slice(expected.length))) add("atdd-bun.topology.test-location", root, path, `${h.urn.value} must live beneath ${expected}{unit,contract,integration}/`, h.urn.line, h.urn.raw);
    if (wagon && feature && !declaredFeatures.has(`${wagon}:${feature}`)) add("planner.feature.wagon-link", root, path, `${h.urn.value} names undeclared feature:${wagon}:${feature}`, h.urn.line, h.urn.raw);
    if (wagon && acceptance && h.acceptance.value !== `acc:${wagon}:${acceptance}`) add("atdd-bun.topology.test-location", root, path, `${h.urn.value} must bind Acceptance: acc:${wagon}:${acceptance}`, h.acceptance.line, h.acceptance.raw);
  }
  const e2eRoot = join(root, cfg.e2e_root);
  const interlockingRoutes = new Set();
  for (const interlocking of docs.filter(doc => text(doc.data, "interlocking_id").startsWith("interlocking:"))) {
    const id = text(interlocking.data, "interlocking_id").slice(13);
    for (const route of list(interlocking.data, "routes")) {
      const routeId = text(route, "route_id"); if (!routeId) continue;
      const expected = join(e2eRoot, "interlockings", id, `${routeId}.routes.test.ts`);
      interlockingRoutes.add(rel(root, expected));
      if (!existsSync(expected)) add("atdd-bun.topology.e2e-location", root, interlocking.path, `${text(interlocking.data, "interlocking_id")} route ${routeId} requires ${rel(root, expected)}`);
    }
  }
  for (const journey of docs.filter(doc => text(doc.data, "journey_id").startsWith("journey:"))) {
    const entry = journey.data.entrypoint, id = text(journey.data, "journey_id").slice(8), path = join(e2eRoot, "journeys", `${id}.journey.test.ts`);
    if (entry && typeof entry === "object" && entry.exposed === true && !existsSync(path)) add("atdd-bun.topology.e2e-location", root, journey.path, `exposed journey:${id} requires ${cfg.e2e_root}/journeys/${id}.journey.test.ts`);
    else if (entry && typeof entry === "object" && entry.exposed === true && !header(path).train.value.startsWith("train:")) add("atdd-bun.topology.e2e-location", root, path, "journey E2E test requires Train: train:… binding");
  }
  for (const path of walk(e2eRoot, path => testName.test(path))) {
    const location = rel(root, path), h = header(path);
    if (location.startsWith(`${cfg.e2e_root}/journeys/`) && !/\.journey\.test\.[cm]?[jt]sx?$/.test(path)) add("atdd-bun.topology.e2e-location", root, path, "journey E2E tests must end in .journey.test.ts", h.urn.line, h.urn.raw);
    if (location.startsWith(`${cfg.e2e_root}/interlockings/`) && !/\.routes\.test\.[cm]?[jt]sx?$/.test(path)) add("atdd-bun.topology.e2e-location", root, path, "interlocking E2E tests must end in .routes.test.ts", h.urn.line, h.urn.raw);
    if (location.startsWith(`${cfg.e2e_root}/interlockings/`) && /\.routes\.test\.[cm]?[jt]sx?$/.test(path) && interlockingRoutes.size && !interlockingRoutes.has(location)) add("atdd-bun.topology.e2e-location", root, path, "interlocking E2E test does not name a declared route", h.urn.line, h.urn.raw);
  }
}
writeFileSync(report, JSON.stringify({ violations }, null, 2));
