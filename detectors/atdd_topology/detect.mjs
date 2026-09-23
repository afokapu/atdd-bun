#!/usr/bin/env bun
// Configurable plan/source/test/E2E topology and feature-decomposition gate.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { topologyFor } from "../../src/topology.ts";

const roots = JSON.parse(process.env.ATDD_SCAN_ROOTS || "[]"), report = process.env.ATDD_VIOLATIONS_REPORT;
if (!report) process.exit(2);
const sourceExt = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cts", ".cjs", ".html", ".htm"]);
const testName = /(?:^test_.*|.*(?:\.test|\.spec|_test))\.(?:[cm]?[jt]sx?)$/;
const slug = "[a-z][a-z0-9-]*";
const componentUrn = new RegExp(`^component:(${slug}):(${slug}):[A-Za-z0-9.]+:(frontend|backend):(domain|application|integration|presentation)$`);
const testUrn = new RegExp(`^test:(${slug}):(${slug}):([A-Za-z0-9][A-Za-z0-9._-]*)$`);
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
    if (["node_modules", ".git", ".atdd", "dist", "build", ".next", "_generated"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, predicate, found); else if (predicate(path)) found.push(path);
  }
  return found;
}
async function topology(root) { const value = await topologyFor(root); return { plan_root: value.planRoot, source_root: value.sourceRoot, test_root: value.testRoot, e2e_root: value.e2eRoot }; }
function header(path) {
  const lines = read(path).split(/\r?\n/).slice(0, 60);
  const field = name => {
    const index = lines.findIndex(line => new RegExp(`^\\s*//\\s*${name}:\\s*(\\S.*?)\\s*$`).test(line));
    return index < 0 ? { value: "", line: 1, raw: "" } : { value: lines[index].replace(new RegExp(`^\\s*//\\s*${name}:\\s*`), "").trim(), line: index + 1, raw: lines[index].trim() };
  };
  return { urn: field("URN"), acceptance: field("Acceptance"), train: field("Train"), journey: field("Journey") };
}

for (const root of roots) {
  const cfg = await topology(root), planRoot = join(root, cfg.plan_root), docs = [];
  for (const path of walk(planRoot, path => /\.ya?ml$/.test(path))) {
    try { const data = Bun.YAML.parse(read(path)); if (data && typeof data === "object" && !Array.isArray(data)) docs.push({ path, data }); } catch { /* schema validation owns parse errors */ }
  }
  const wagons = docs.filter(doc => text(doc.data, "urn").startsWith("wagon:")).map(doc => ({ ...doc, slug: text(doc.data, "urn").slice(6) }));
  const features = docs.filter(doc => text(doc.data, "urn").startsWith("feature:")).map(doc => { const [,, wagon, slug] = ["", ...text(doc.data, "urn").split(":")]; return { ...doc, wagon, slug, urn: text(doc.data, "urn") }; });
  const wmbts = docs.filter(doc => text(doc.data, "urn").startsWith("wmbt:")).map(doc => { const [, wagon, code] = text(doc.data, "urn").split(":"); return { ...doc, wagon, code, urn: text(doc.data, "urn") }; });
  const featureByUrn = new Map(features.map(feature => [feature.urn, feature])), memberships = new Map(), wmbtOwners = new Map(), sourceByFeature = new Map(), testByFeature = new Map();
  const acceptances = new Set(wmbts.flatMap(wmbt => list(wmbt.data, "acceptances").map(acceptance => text(acceptance?.identity, "urn")).filter(Boolean)));
  // The feature(s) that own each acceptance, through the WMBTs they list: a test is credited only to its owner.
  const acceptanceOwners = new Map();
  for (const feature of features) for (const wmbtUrn of list(feature.data, "wmbts").map(String)) for (const wmbt of wmbts.filter(w => w.urn === wmbtUrn))
    for (const acceptance of list(wmbt.data, "acceptances").map(a => text(a?.identity, "urn")).filter(Boolean)) acceptanceOwners.set(acceptance, [...(acceptanceOwners.get(acceptance) || []), `${feature.wagon}:${feature.slug}`]);
  const trains = new Set(docs.map(doc => text(doc.data, "train_id")).filter(Boolean));

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
  // A repository can ship an independent frontend or infrastructure fixture with journeys but
  // no wagon/feature plan. Feature layout begins only when the plan models a feature; this
  // preserves that boundary while making every modeled feature strict.
  const modelsFeatures = wagons.length > 0 || features.length > 0 || wmbts.length > 0;
  if (modelsFeatures) for (const path of walk(join(root, cfg.source_root), path => sourceExt.has(path.slice(path.lastIndexOf("."))) && !testName.test(path))) {
    const h = header(path), match = componentUrn.exec(h.urn.value);
    if (!match) { add("atdd-bun.topology.source-location", root, path, "source requires URN: component:{wagon}:{feature}:{name}:{frontend|backend}:{domain|application|integration|presentation}", h.urn.line, h.urn.raw); continue; }
    const wagon = match[1], feature = match[2], layer = match[4], expected = `${cfg.source_root}/${wagon}/features/${feature}/${layer === "integration" ? "infrastructure" : layer}/`;
    if (!rel(root, path).startsWith(expected)) add("atdd-bun.topology.source-location", root, path, `${h.urn.value} must live beneath ${expected}`, h.urn.line, h.urn.raw);
    else sourceByFeature.set(`${wagon}:${feature}`, [...(sourceByFeature.get(`${wagon}:${feature}`) || []), path]);
    if (wagon && feature && !declaredFeatures.has(`${wagon}:${feature}`)) add("planner.feature.wagon-link", root, path, `${h.urn.value} names undeclared feature:${wagon}:${feature}`, h.urn.line, h.urn.raw);
  }
  if (modelsFeatures) for (const path of walk(join(root, cfg.test_root), path => testName.test(path))) {
    const h = header(path), match = testUrn.exec(h.urn.value);
    if (!match) { add("atdd-bun.topology.test-location", root, path, "test requires URN: test:{wagon}:{feature}:{acceptance}", h.urn.line, h.urn.raw); continue; }
    const [, wagon, feature, acceptance] = match, expected = `${cfg.test_root}/${wagon}/features/${feature}/`;
    if (!rel(root, path).startsWith(expected) || !/(unit|contract|integration)\//.test(rel(root, path).slice(expected.length))) add("atdd-bun.topology.test-location", root, path, `${h.urn.value} must live beneath ${expected}{unit,contract,integration}/`, h.urn.line, h.urn.raw);
    if (wagon && feature && !declaredFeatures.has(`${wagon}:${feature}`)) add("planner.feature.wagon-link", root, path, `${h.urn.value} names undeclared feature:${wagon}:${feature}`, h.urn.line, h.urn.raw);
    const binding = `acc:${wagon}:${acceptance}`;
    if (h.acceptance.value !== binding) add("atdd-bun.topology.test-location", root, path, `${h.urn.value} must bind Acceptance: ${binding}`, h.acceptance.line, h.acceptance.raw);
    else if (!acceptances.has(binding)) add("atdd-bun.topology.test-location", root, path, `${binding} is not declared by a WMBT in ${cfg.plan_root}/`, h.acceptance.line, h.acceptance.raw);
    else if (acceptanceOwners.has(binding) && !acceptanceOwners.get(binding).includes(`${wagon}:${feature}`)) add("atdd-bun.topology.test-location", root, path, `${binding} belongs to feature:${acceptanceOwners.get(binding).join(", feature:")}, not feature:${wagon}:${feature}; a test lives beneath the feature whose acceptance it proves`, h.acceptance.line, h.acceptance.raw);
    else testByFeature.set(`${wagon}:${feature}`, [...(testByFeature.get(`${wagon}:${feature}`) || []), path]);
  }
  for (const feature of features) if (list(feature.data, "wmbts").length) {
    const key = `${feature.wagon}:${feature.slug}`;
    if (!sourceByFeature.get(key)?.length) add("atdd-bun.topology.feature-source-coverage", root, feature.path, `${feature.urn} owns WMBTs but has no source component beneath ${cfg.source_root}/${feature.wagon}/features/${feature.slug}/`);
    if (!testByFeature.get(key)?.length) add("atdd-bun.topology.feature-test-coverage", root, feature.path, `${feature.urn} owns WMBTs but has no test bound to one of its acceptances`);
  }
  const e2eRoot = join(root, cfg.e2e_root);
  // A browser test is the E2E proof for a frontend behavior. It deliberately
  // substitutes for the Bun E2E path below, never supplements it: one behavior,
  // one runner. htmx_e2e_detector (included in the tester profile) owns the
  // stricter Playwright naming, header, subject, and harness validation.
  const browserTrains = new Set(), browserJourneys = new Set();
  for (const path of walk(e2eRoot, path => /\.e2e\.[cm]?[jt]sx?$/.test(path))) {
    const content = read(path), h = header(path);
    if (!/from\s+["']@playwright\/test["']/.test(content) || !/(^|[^.\w])test(\.(describe|only|skip|fixme|fail|slow|step))?\s*\(/m.test(content)) continue;
    // A browser spec carries its journey identity as a test URN, not an Acceptance (tester.htmx forbids
    // Acceptance on journey specs). It substitutes only when that URN is a valid E2E or SMOKE proof for the
    // very train or journey it is bound to.
    // The proof is the `// URN:` header, whole: a URN-shaped string elsewhere in the file (a decoy constant) proves nothing.
    const proves = (subject) => h.urn.value.startsWith(`test:${subject}:`) && /^(E2E|SMOKE)-\d{3}-[a-z0-9][a-z0-9-]*$/.test(h.urn.value.slice(`test:${subject}:`.length));
    if (h.train.value && proves(h.train.value)) browserTrains.add(h.train.value);
    if (h.journey.value && proves(h.journey.value)) browserJourneys.add(h.journey.value);
  }
  const interlockingRoutes = new Set();
  const interlockings = new Map(docs.filter(doc => text(doc.data, "interlocking_id").startsWith("interlocking:")).map(doc => [text(doc.data, "interlocking_id"), doc]));
  const journeys = docs.filter(doc => text(doc.data, "journey_id").startsWith("journey:"));
  const journeyReachability = journey => {
    const continuations = list(journey.data, "continuations"), reachable = new Set(), queue = [text(journey.data.entrypoint, "interlocking_id")].filter(Boolean);
    while (queue.length) {
      const interlockingId = queue.shift(); if (!interlockingId || reachable.has(interlockingId)) continue;
      reachable.add(interlockingId);
      for (const continuation of continuations) if (text(continuation?.from, "interlocking_id") === interlockingId && text(continuation?.to, "interlocking_id")) queue.push(text(continuation.to, "interlocking_id"));
    }
    return reachable;
  };
  const hasFrontendSurface = entry => !Array.isArray(entry?.surfaces) || entry.surfaces.map(String).includes("frontend");
  const frontendInterlockings = new Set(journeys.filter(journey => {
    const entry = journey.data.entrypoint;
    return entry && typeof entry === "object" && entry.exposed === true && hasFrontendSurface(entry);
  }).flatMap(journey => [...journeyReachability(journey)]));
  for (const interlocking of interlockings.values()) {
    const id = text(interlocking.data, "interlocking_id").slice(13);
    for (const route of list(interlocking.data, "routes")) {
      const routeId = text(route, "route_id"); if (!routeId) continue;
      const expected = join(e2eRoot, "interlockings", id, `${routeId}.routes.test.ts`);
      interlockingRoutes.add(rel(root, expected));
      const browserEligible = frontendInterlockings.has(text(interlocking.data, "interlocking_id"));
      if (!existsSync(expected) && !(browserEligible && browserTrains.has(text(route, "train_id")))) add("atdd-bun.topology.e2e-location", root, interlocking.path, browserEligible
        ? `${text(interlocking.data, "interlocking_id")} route ${routeId} requires ${rel(root, expected)} or a Playwright E2E spec bound to Train: ${text(route, "train_id")}`
        : `${text(interlocking.data, "interlocking_id")} route ${routeId} is not on an exposed frontend journey and requires ${rel(root, expected)}`);
    }
  }
  for (const journey of journeys) {
    const entry = journey.data.entrypoint, id = text(journey.data, "journey_id").slice(8), path = join(e2eRoot, "journeys", `${id}.journey.test.ts`);
    const reachable = journeyReachability(journey), journeyTrains = new Set([...reachable].flatMap(interlockingId => list(interlockings.get(interlockingId)?.data, "routes").map(route => text(route, "train_id")).filter(Boolean)));
    const browserEligible = entry && typeof entry === "object" && hasFrontendSurface(entry);
    if (entry && typeof entry === "object" && entry.exposed === true && !existsSync(path) && !(browserEligible && browserJourneys.has(`journey:${id}`))) add("atdd-bun.topology.e2e-location", root, journey.path, browserEligible
      ? `exposed journey:${id} requires ${cfg.e2e_root}/journeys/${id}.journey.test.ts or a Playwright E2E spec bound to Journey: journey:${id}`
      : `exposed backend journey:${id} requires ${cfg.e2e_root}/journeys/${id}.journey.test.ts`);
    else if (entry && typeof entry === "object" && entry.exposed === true && existsSync(path)) {
      const h = header(path), match = testUrn.exec(h.urn.value);
      if (!match || !declaredFeatures.has(`${match[1]}:${match[2]}`)) add("atdd-bun.topology.e2e-location", root, path, "journey E2E test requires a test:{wagon}:{feature}:{acceptance} URN naming a declared feature", h.urn.line, h.urn.raw);
      else if (h.acceptance.value !== `acc:${match[1]}:${match[3]}` || !acceptances.has(h.acceptance.value)) add("atdd-bun.topology.e2e-location", root, path, `journey E2E test requires Acceptance: acc:${match[1]}:${match[3]}, declared by a WMBT in ${cfg.plan_root}/`, h.acceptance.line, h.acceptance.raw);
      if (!trains.has(h.train.value) || !journeyTrains.has(h.train.value)) add("atdd-bun.topology.e2e-location", root, path, `journey E2E Train: must resolve to a reachable selected train; found ${h.train.value || "<missing>"}`, h.train.line, h.train.raw);
    }
  }
  for (const path of walk(e2eRoot, path => testName.test(path))) {
    const location = rel(root, path), h = header(path);
    if (location.startsWith(`${cfg.e2e_root}/journeys/`) && !/\.journey\.test\.[cm]?[jt]sx?$/.test(path)) add("atdd-bun.topology.e2e-location", root, path, "journey E2E tests must end in .journey.test.ts", h.urn.line, h.urn.raw);
    if (location.startsWith(`${cfg.e2e_root}/interlockings/`) && !/\.routes\.test\.[cm]?[jt]sx?$/.test(path)) add("atdd-bun.topology.e2e-location", root, path, "interlocking E2E tests must end in .routes.test.ts", h.urn.line, h.urn.raw);
    if (location.startsWith(`${cfg.e2e_root}/interlockings/`) && /\.routes\.test\.[cm]?[jt]sx?$/.test(path) && interlockingRoutes.size && !interlockingRoutes.has(location)) add("atdd-bun.topology.e2e-location", root, path, "interlocking E2E test does not name a declared route", h.urn.line, h.urn.raw);
    if (location.startsWith(`${cfg.e2e_root}/interlockings/`) && /\.routes\.test\.[cm]?[jt]sx?$/.test(path)) {
      const match = testUrn.exec(h.urn.value);
      if (!match || !declaredFeatures.has(`${match[1]}:${match[2]}`)) add("atdd-bun.topology.e2e-location", root, path, "interlocking E2E test requires a test:{wagon}:{feature}:{acceptance} URN naming a declared feature", h.urn.line, h.urn.raw);
      else if (h.acceptance.value !== `acc:${match[1]}:${match[3]}` || !acceptances.has(h.acceptance.value)) add("atdd-bun.topology.e2e-location", root, path, "interlocking E2E test requires an Acceptance: binding declared by a WMBT", h.acceptance.line, h.acceptance.raw);
    }
  }
}
writeFileSync(report, JSON.stringify({ violations }, null, 2));
