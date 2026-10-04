import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { concreteProfiles, declaredRuleIds, profileConventions, profileImplementations } from "../src/enforce";
import { PROFILE_REGISTRY_DIR, profileRegistries } from "../src/profile-registry";

const root = resolve(import.meta.dir, "..");
type Registry = { profile: string; implementations: string[]; conventions: Array<{ rule_id: string; path: string }>; relationships: Array<{ source_ref: string; target_ref: string }> };

test("profile registries are a current deterministic projection of profile manifests and direct graph edges", async () => {
  expect((await profileRegistries({ root, check: true })).ok).toBeTrue();
  const preset = Bun.YAML.parse(await readFile(join(root, "conventions/atdd-bun.profiles/atdd-bun.profiles.presets.convention.yaml"), "utf8")) as { terms: Array<{ term_id: string; values: Record<string, string> }> };
  const registryPaths = preset.terms.find(term => term.term_id === "profile_registries")!.values;
  for (const profile of concreteProfiles) {
    const registry = Bun.YAML.parse(await readFile(join(root, PROFILE_REGISTRY_DIR, `${profile}.yaml`), "utf8")) as Registry;
    const implementations = [...profileImplementations[profile]].sort();
    const ids = [...new Set((await Promise.all(implementations.map(implementation => declaredRuleIds(implementation)))).flatMap(set => [...set]))].sort();
    const conventions = [...ids, ...profileConventions[profile].map(convention => convention.rule_id)].sort();
    expect(registry.profile).toBe(profile);
    expect(registryPaths[profile]).toBe(`${PROFILE_REGISTRY_DIR}/${profile}.yaml`);
    expect(registry.implementations).toEqual(implementations);
    expect(registry.conventions.map(convention => convention.rule_id)).toEqual(conventions);
    expect(registry.conventions.every(convention => convention.path.endsWith(".convention.yaml"))).toBeTrue();
    const rules = new Set(conventions);
    expect(registry.relationships.every(edge => rules.has(edge.source_ref) || rules.has(edge.target_ref))).toBeTrue();
  }
});
