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
      if (line === "emits_rule_ids:") { inList = true; continue; }
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
