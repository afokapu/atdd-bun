import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { implementationsFor } from "../src/enforce";

// Every rule a detector can emit is covered by the per-rule checks. The checks in dispositions.test.ts
// and relationships.test.ts start from convention FILES, so a rule without a file is invisible to them;
// this test closes that gap by starting from what detectors DECLARE. A package rule needs a convention
// under conventions/; a canonical planner rule needs its node and a strict ENFORCEMENT_SCOPE entry.
const root = resolve(import.meta.dir, "..");

async function declaredRules(): Promise<Map<string, string>> {
  const rules = new Map<string, string>();
  for (const implementation of implementationsFor(["all"])) {
    const manifest = await readFile(join(root, "detectors", implementation, "atdd.implementation.yaml"), "utf8");
    let inList = false;
    for (const line of manifest.split("\n")) {
      if (line === "emits_rule_ids:" || line === "api_emits_rule_ids:") { inList = true; continue; }
      if (inList && /^[A-Za-z_][\w-]*:/.test(line)) break;
      const match = inList && line.match(/^\s*-\s+([^#\s]+)/);
      if (match) rules.set(match[1], implementation);
    }
  }
  return rules;
}

async function conventionIds(dir: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) for (const id of await conventionIds(path)) ids.add(id);
    else if (entry.name.endsWith(".convention.yaml")) { const id = (Bun.YAML.parse(await readFile(path, "utf8")) as { rule_id?: string }).rule_id; if (id) ids.add(id); }
  }
  return ids;
}

test("every rule any detector declares, guards included, is covered by a convention or a strict canonical node", async () => {
  const packageConventions = await conventionIds(join(root, "conventions")), canonicalNodes = await conventionIds(join(root, "planner-nodes/nodes"));
  const scope = Bun.YAML.parse(await readFile(join(root, "planner-nodes/ENFORCEMENT_SCOPE.yaml"), "utf8")) as { canonical_bun_enforcement: Array<{ rule_id: string; disposition?: string }> };
  const strictScope = new Set(scope.canonical_bun_enforcement.filter(item => item.disposition === "strict" || item.disposition === "block").map(item => item.rule_id));
  const uncovered = [...await declaredRules()].filter(([rule]) => !packageConventions.has(rule) && !(canonicalNodes.has(rule) && strictScope.has(rule))).map(([rule, implementation]) => `${rule} (${implementation}): ${canonicalNodes.has(rule) ? "canonical node not declared strict in ENFORCEMENT_SCOPE.yaml" : "no convention under conventions/"}`);
  expect(uncovered).toEqual([]);
});

// Rules a detector could emit on inputs no fixture covers are still caught: every rule-id literal in
// detector and package source must be declared by a manifest (emits_rule_ids or api_emits_rule_ids).
// planner.kernel.* ids are internal and must each map to a declared package rule.
async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "fixtures" && entry.name !== "node_modules") out.push(...await sourceFiles(path)); }
    else if (/\.(m?js|ts)$/.test(entry.name)) out.push(path);
  }
  return out;
}
const RULE_LITERAL = /["'`]((?:planner|coder|tester|traceability|atdd-bun)\.[a-z0-9-]+(?:\.[a-z0-9-]+)+)["'`]/g;
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

test("every rule id written in detector or package source is declared, so no emission path escapes", async () => {
  const declared = await declaredRules(), undeclared = new Set<string>();
  for (const file of [...await sourceFiles(join(root, "detectors")), ...await sourceFiles(join(root, "src"))])
    for (const match of withoutComments(await readFile(file, "utf8")).matchAll(RULE_LITERAL)) {
      const id = match[1];
      if (/\.(ts|js|mjs|json|ya?ml|md|adoc)$/.test(id) || id.startsWith("planner.kernel.")) continue; // a file name, or an internal kernel id
      if (!declared.has(id)) undeclared.add(`${id} (${file.slice(root.length + 1)})`);
    }
  expect([...undeclared].sort()).toEqual([]);
});

test("every internal planner.kernel.* finding maps to a declared package rule", async () => {
  const kernel = await readFile(join(root, "src/planner-kernel.ts"), "utf8"), detector = await readFile(join(root, "detectors/planner_plan_integrity/detect.mjs"), "utf8");
  const produced = [...new Set([...kernel.matchAll(/finding\("(planner\.kernel\.[a-z-]+)"/g)].map(m => m[1]))].sort();
  const mapping = new Map([...detector.matchAll(/"(planner\.kernel\.[a-z-]+)":\s*"([^"]+)"/g)].map(m => [m[1], m[2]]));
  const declared = await declaredRules();
  expect(produced.length).toBeGreaterThan(0);
  expect(produced.filter(id => !mapping.has(id) || !declared.has(mapping.get(id)!)).map(id => `${id} -> ${mapping.get(id) ?? "unmapped"}`)).toEqual([]);
});
