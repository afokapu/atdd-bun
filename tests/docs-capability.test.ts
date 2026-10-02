import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { DOC_RULE_IDS, checkDocumentation, parseAttributes, scanDocumentation } from "../src/docs-capability";

const fixtures = join(resolve(import.meta.dir, ".."), "detectors/planner_docs_capability/fixtures");
const ids = (items: { rule_id: string | null }[]) => new Set(items.flatMap(item => item.rule_id ? [item.rule_id] : []));

test("documentation corpus clean fixture is clean", async () => {
  expect(await scanDocumentation(join(fixtures, "clean"))).toEqual([]);
});

test("each filesystem documentation rule has an isolated upstream fixture", async () => {
  const expectations: Record<string, string> = {
    dirty_markdown: "planner.docs.asciidoc-only", dirty_identity: "planner.docs.identity-required",
    dirty_duplicate_id: "planner.docs.doc-id-unique", dirty_unresolved_edge: "planner.docs.graph-target-resolves",
    dirty_missing_index: "planner.docs.area-index-required", dirty_adr_registry: "planner.docs.adr-registry-derived",
  };
  for (const [fixture, rule] of Object.entries(expectations)) expect(ids(await scanDocumentation(join(fixtures, fixture))), fixture).toEqual(new Set([rule]));
});

test("header identity stops at body text and never adopts code samples", () => {
  expect(parseAttributes("= Title\n:doc-id: real\n\nBody\n:doc-id: impostor\n").attrs["doc-id"]).toBe("real");
  expect(parseAttributes("= Title\nProse first\n:doc-id: impostor\n").attrs["doc-id"]).toBeUndefined();
});

test("declaration, change-set, missing-artifact, seam, and renderer paths preserve the verdict contract", async () => {
  const root = join(fixtures, "clean");
  const declaration = { impact: "change", artifacts: [{ action: "modify", path: "docs/purpose/index.adoc" }] } as const;
  expect((await checkDocumentation({ root, declaration, changeSet: [], render: async () => ({ findings: [] }) })).verdict).toBe("PASS");
  expect((await checkDocumentation({ root, declaration: { impact: "none" }, changeSet: null })).verdict).toBe("NOT_APPLICABLE");
  expect((await checkDocumentation({ root, declaration: null, changeSet: [] })).verdict).toBe("COULD_NOT_CHECK");
  expect((await checkDocumentation({ root, declaration, changeSet: null })).verdict).toBe("COULD_NOT_CHECK");
  const cleanRender = async () => ({ findings: [] });
  const bad = await checkDocumentation({ root, declaration: { impact: "typo", artifacts: [{ action: "archive", path: "docs/purpose/history.md" }] }, changeSet: ["docs/new.adoc"], render: cleanRender });
  expect(ids(bad.findings)).toEqual(new Set(["planner.docs.artifact-path-shape", "planner.docs.undeclared-change"]));
  const missing = await checkDocumentation({ root, declaration: { impact: "change", artifacts: [{ action: "create", path: "docs/purpose/not-written.adoc" }] }, changeSet: [], render: cleanRender });
  expect(ids(missing.findings)).toEqual(new Set(["planner.docs.artifact-path-shape"]));
  const render = await checkDocumentation({ root, declaration, changeSet: [], render: async () => ({ findings: [], couldNotCheck: "asciidoctor absent" }) });
  expect(render.verdict).toBe("COULD_NOT_CHECK");
  expect(ids(render.findings)).toEqual(new Set(["planner.docs.reference-integrity"]));
  expect((await checkDocumentation({ root, declaration, changeSet: [], render: async () => { throw new Error("renderer exploded"); } })).verdict).toBe("FAIL");
});

test("every documentation convention is represented by the Bun capability", () => {
  expect(DOC_RULE_IDS).toHaveLength(10);
});

test("every documentation rule has a deliberate failing scenario", async () => {
  const observed = new Set<string>();
  for (const fixture of ["dirty_markdown", "dirty_identity", "dirty_duplicate_id", "dirty_unresolved_edge", "dirty_missing_index", "dirty_adr_registry", "dirty_journey_view"]) for (const item of await scanDocumentation(join(fixtures, fixture))) observed.add(item.rule_id);
  const root = join(fixtures, "clean"), render = async () => ({ findings: [] });
  for (const item of (await checkDocumentation({ root, declaration: { impact: "typo", artifacts: [{ action: "archive", path: "docs/purpose/history.md" }] }, changeSet: ["docs/undeclared.adoc"], render })).findings) if (item.rule_id) observed.add(item.rule_id);
  for (const item of (await checkDocumentation({ root, declaration: { impact: "change", artifacts: [] }, changeSet: [], render: async () => ({ findings: [{ rule_id: "planner.docs.reference-integrity" as const, file: "docs/a.adoc", line: 1, col: 1, evidence: "broken xref", source_line: "" }] }) })).findings) if (item.rule_id) observed.add(item.rule_id);
  expect(observed).toEqual(new Set(DOC_RULE_IDS));
});

test("docs adr-register regenerates the marked region, so the derived-registry rule passes without a typed entry", async () => {
  // resolver-os #dwbmACoYwOnz: the rule required regenerating the register and the toolkit shipped no way to do it.
  const { adrRegister, scanDocumentation } = await import("../src/docs-capability");
  const root = await (await import("node:fs/promises")).mkdtemp(join((await import("node:os")).tmpdir(), "atdd-adr-"));
  const { mkdir, writeFile, rm } = await import("node:fs/promises");
  try {
    await mkdir(join(root, "docs", "architecture", "decisions"), { recursive: true });
    await writeFile(join(root, "docs", "architecture", "decisions", "adr-20261001-033-runtime.adoc"), ":doc-id: adr-runtime\n:adr-id: ADR-20261001-033\n:status: accepted\n:date: 2026-10-01\n:decides: adr-runtime\n\n= Managed runtime pivot\n");
    const index = join(root, "docs", "architecture", "decisions", "index.adoc");
    await writeFile(index, ":doc-id: adr-index\n\n= Decisions\n\n// BEGIN GENERATED: adr-register\n// END GENERATED: adr-register\n");
    const registry = async () => (await scanDocumentation(root)).filter(v => v.rule_id === "planner.docs.adr-registry-derived");
    expect((await registry()).length).toBe(1);
    expect((await adrRegister(root, true)).ok).toBe(false);
    expect((await adrRegister(root)).ok).toBe(true);
    expect(await registry()).toEqual([]);
    expect((await adrRegister(root, true)).ok).toBe(true);
    await writeFile(index, ":doc-id: adr-index\n\n= Decisions\n");
    expect((await adrRegister(root)).message).toContain("no adr-register region");
  } finally { await rm(root, { recursive: true, force: true }); }
});
