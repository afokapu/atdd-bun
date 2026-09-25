import { existsSync } from "node:fs";
import { journeyDocs, journeyDocsApply } from "./journey-docs";
import { DEFAULT_ROOT, deliveryAdopted, deliveryPolicy } from "./delivery";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export const DOC_RULE_IDS = [
  "planner.docs.asciidoc-only", "planner.docs.identity-required", "planner.docs.doc-id-unique",
  "planner.docs.graph-target-resolves", "planner.docs.area-index-required", "planner.docs.adr-registry-derived",
  "planner.docs.artifact-path-shape", "planner.docs.undeclared-change", "planner.docs.reference-integrity", "planner.docs.journey-view-current",
] as const;
export type DocumentationRuleId = typeof DOC_RULE_IDS[number];
export type DocumentationViolation = { rule_id: DocumentationRuleId; file: string; line: number; col: number; evidence: string; source_line: string };
export type DocumentationDeclaration = { impact?: "change" | "none" | string; artifacts?: Array<{ action?: string; path?: string; from?: string }> };
export type DocumentationCheck = { verdict: "PASS" | "FAIL" | "COULD_NOT_CHECK" | "NOT_APPLICABLE"; findings: Array<DocumentationViolation | { rule_id: null; where: string; message: string }>; checked: string[] };
export type DocumentationRender = { findings: DocumentationViolation[]; couldNotCheck?: string };

const DOCS = "docs";
const DIST = "docs/dist";
const AREAS = ["docs", "docs/purpose", "docs/architecture", "docs/architecture/decisions", "docs/delivery", "docs/archive"];
const VERBS = ["decides", "supersedes", "implements", "depends-on"];
const ADR_DIR = "docs/architecture/decisions";
const ADR_INDEX = `${ADR_DIR}/index.adoc`;
type Document = { path: string; text: string; attrs: Record<string, string>; lines: Record<string, number> };

const generated = (path: string) => path === DIST || path.startsWith(`${DIST}/`);
const lineAt = (text: string, line: number) => text.split(/\r?\n/)[line - 1] ?? "";
const violation = (rule_id: DocumentationRuleId, file: string, line: number, evidence: string, source_line = ""): DocumentationViolation => ({ rule_id, file, line, col: 1, evidence, source_line });

async function walk(root: string, suffix: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(async entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return walk(path, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [path] : [];
  }))).flat().sort();
}

export function parseAttributes(text: string): { attrs: Record<string, string>; lines: Record<string, number> } {
  const attrs: Record<string, string> = {}, lines: Record<string, number> = {};
  let sawAttribute = false;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const match = line.match(/^:([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*?)[ \t]*$/);
    if (match) { sawAttribute = true; if (!(match[1] in attrs)) { attrs[match[1]] = match[2]; lines[match[1]] = index + 1; } continue; }
    if (!line.trim()) { if (sawAttribute) break; continue; }
    if (line.startsWith("=")) continue;
    break;
  }
  return { attrs, lines };
}

/** The delivery profile's records folder, when it is adopted: tranche records and reports are YAML and data, judged by
 * that profile, never authored documentation. The docs profile leaves the folder (by default docs/delivery/tranches) to
 * it; the rest of docs/delivery, the program's reasoning, stays documentation. */
async function deliveryRecords(root: string): Promise<(path: string) => boolean> {
  const file = join(root, "atdd-bun.yaml");
  try {
    const data = existsSync(file) ? Bun.YAML.parse(await readFile(file, "utf8")) as Record<string, unknown> | null : null;
    if (!deliveryAdopted(data)) return () => false;
    // Only the one folder the delivery profile may use under docs/; a root configured anywhere else in docs/ is a delivery
    // finding and exempts nothing here.
    if (deliveryPolicy(data!.delivery).root !== DEFAULT_ROOT) return () => false;
    return path => path === DEFAULT_ROOT || path.startsWith(`${DEFAULT_ROOT}/`);
  } catch { return () => false; }
}

async function documents(root: string): Promise<Document[]> {
  const paths = await walk(join(root, DOCS), ".adoc"), records = await deliveryRecords(root);
  return Promise.all(paths.filter(path => { const file = relative(root, path).replaceAll("\\", "/"); return !generated(file) && !records(file); }).map(async path => {
    const text = await readFile(path, "utf8"); const parsed = parseAttributes(text);
    return { path: relative(root, path).replaceAll("\\", "/"), text, ...parsed };
  }));
}

function graphViolations(docs: Document[]): DocumentationViolation[] {
  const ids = new Set(docs.map(d => d.attrs["doc-id"]).filter(Boolean)); const output: DocumentationViolation[] = [];
  for (const doc of docs) for (const verb of VERBS) for (const target of (doc.attrs[verb] ?? "").split(",").map(x => x.trim()).filter(Boolean)) {
    if (!ids.has(target)) output.push(violation("planner.docs.graph-target-resolves", doc.path, doc.lines[verb] ?? 1, `${doc.attrs["doc-id"]} :${verb}: ${target} — no document declares the doc-id ${JSON.stringify(target)}. The target was REPORTED and no node was created for it; declare the target document, or fix the reference.`, lineAt(doc.text, doc.lines[verb] ?? 1)));
  }
  return output;
}

function registryText(text: string): string {
  const regions = [...text.matchAll(/^\/\/\s*BEGIN GENERATED:\s*(?<name>[a-z0-9-]*).*?^\/\/\s*END GENERATED:\s*\k<name>\b/gms)].map(m => m[0]);
  const named = regions.filter(region => region.split("\n", 1)[0].includes("adr-register"));
  return named.length ? named.join("\n") : text.replace(/^----\s*$.*?^----\s*$/gms, "");
}

function adrViolations(docs: Document[]): DocumentationViolation[] {
  const adr = docs.filter(d => d.path.startsWith(`${ADR_DIR}/`) && /^adr-\d{8}-\d{3}-[a-z0-9][a-z0-9-]*\.adoc$/.test(basename(d.path)));
  const output: DocumentationViolation[] = [];
  for (const doc of adr.filter(d => !d.attrs["adr-id"])) output.push(violation("planner.docs.adr-registry-derived", doc.path, 1, `${doc.path} is named as an ADR but declares no :adr-id:, so it cannot be projected into the registry and no rule can see it. Declare :adr-id: matching its filename.`));
  const derived = new Set(adr.map(d => d.attrs["adr-id"]).filter(Boolean));
  const registry = docs.find(d => d.path === ADR_INDEX);
  if (!registry) return derived.size ? [...output, violation("planner.docs.adr-registry-derived", ADR_INDEX, 1, `${derived.size} ADR(s) exist and there is no registry to project them into: ${[...derived].sort().join(", ")}.`)] : output;
  const listed = new Set(registryText(registry.text).match(/\bADR-\d{8}-\d{3}\b/g) ?? []);
  if (registry.attrs["adr-id"] && !derived.has(registry.attrs["adr-id"])) listed.delete(registry.attrs["adr-id"]);
  const missing = [...derived].filter(id => !listed.has(id)).sort(), stale = [...listed].filter(id => !derived.has(id)).sort();
  if (missing.length || stale.length) output.push(violation("planner.docs.adr-registry-derived", ADR_INDEX, 1, `the ADR registry has drifted from the :decides: edges it is projected from — ${[missing.length && `missing from the registry: ${missing.join(", ")}`, stale.length && `listed but no such ADR exists: ${stale.join(", ")}`].filter(Boolean).join("; ")}. Regenerate it; do not type the entry.`));
  return output;
}

export async function scanDocumentation(root: string): Promise<DocumentationViolation[]> {
  const absolute = resolve(root), docs = await documents(absolute), output: DocumentationViolation[] = [], records = await deliveryRecords(absolute);
  for (const path of await walk(join(absolute, DOCS), ".md")) { const file = relative(absolute, path).replaceAll("\\", "/"); if (!generated(file) && !records(file)) output.push(violation("planner.docs.asciidoc-only", file, 1, `authored markdown beneath docs/: ${file}. AsciiDoc is the only authored format; convert it, and convert a historical document INTO docs/archive/ rather than into a current area.`, lineAt(await readFile(path, "utf8"), 1))); }
  for (const doc of docs) { const missing = ["doc-id", "status"].filter(name => !doc.attrs[name]); if (missing.length) output.push(violation("planner.docs.identity-required", doc.path, 1, `document declares no ${missing.map(name => `:${name}:`).join(" and no ")}. Identity and currency are both required: an id with no status is a node whose currency is unknown, a status with no id is a claim nothing can reference.`, lineAt(doc.text, 1))); }
  const byId = new Map<string, Document[]>(); for (const doc of docs) if (doc.attrs["doc-id"]) byId.set(doc.attrs["doc-id"], [...(byId.get(doc.attrs["doc-id"]) ?? []), doc]);
  for (const [id, group] of byId) if (group.length > 1) for (const doc of group) { const line = doc.lines["doc-id"] ?? 1; output.push(violation("planner.docs.doc-id-unique", doc.path, line, `doc-id ${JSON.stringify(id)} is declared by ${group.length} documents: ${group.map(d => d.path).join(", ")}. Resolution needs exactly one target per id.`, lineAt(doc.text, line))); }
  output.push(...graphViolations(docs));
  for (const area of AREAS) if (existsSync(join(absolute, area)) && !existsSync(join(absolute, area, "index.adoc"))) output.push(violation("planner.docs.area-index-required", `${area}/index.adoc`, 1, `canonical area ${area}/ exists and carries no index.adoc. The rendered site cannot navigate into an area with no entry point.`));
  output.push(...adrViolations(docs));
  output.push(...await journeyViewViolations(absolute));
  return output;
}

/** Where the plan has journeys or interlockings, the committed journey view must be exactly what plan/ generates. */
async function journeyViewViolations(root: string): Promise<DocumentationViolation[]> {
  if (!await journeyDocsApply(root)) return [];
  const result = await journeyDocs({ root, check: true });
  return result.stale.map(file => violation("planner.docs.journey-view-current", file, 1, `${file} does not match what plan/ generates, so the journey documentation no longer shows the plan. Regenerate it with \`atdd-bun docs journeys\` and commit the result; never edit it by hand.`));
}

export function declarationViolations(declaration: DocumentationDeclaration | null, changeSet?: string[], records: (path: string) => boolean = () => false): DocumentationViolation[] {
  if (!declaration) return [];
  const artifacts = Array.isArray(declaration.artifacts) ? declaration.artifacts : []; const output: DocumentationViolation[] = [];
  if (declaration.impact !== "change" && declaration.impact !== "none") output.push(violation("planner.docs.artifact-path-shape", "<declaration>", 1, `declaration carries impact=${JSON.stringify(declaration.impact)}; the two total forms are ["change", "none"]. A malformed declaration is reported, never treated as nothing-to-check.`));
  for (const [index, artifact] of artifacts.entries()) { const path = artifact.path ?? "", problems: string[] = []; if (!path) problems.push("declares no path"); else { if (!path.startsWith("docs/")) problems.push(`path ${JSON.stringify(path)} is outside the canonical tree (must begin "docs/")`); if (!path.endsWith(".adoc")) problems.push(`path ${JSON.stringify(path)} is not AsciiDoc (must end ".adoc")`); if (artifact.action === "archive" && !path.startsWith("docs/archive/")) problems.push(`archive destination ${JSON.stringify(path)} is outside "docs/archive/" — archiving must preserve history, never promote it into a current area`); } if (problems.length) output.push(violation("planner.docs.artifact-path-shape", path || "<declaration>", 1, `declared artifact[${index}] (action: ${artifact.action || "unset"}): ${problems.join("; ")}`)); }
  if (changeSet) { const covered = new Set(artifacts.flatMap(a => [a.path, a.from]).filter((p): p is string => Boolean(p))); for (const path of [...new Set(changeSet)].sort()) if (path.startsWith("docs/") && !generated(path) && !records(path) && !covered.has(path)) output.push(violation("planner.docs.undeclared-change", path, 1, `the change set touches ${path} and no declared artifact covers it. Declare it at RATIFY; if the change was not planned, the declaration was wrong at RATIFY and re-ratifying is the honest correction.`)); }
  return output;
}

export function parseAsciidoctorDiagnostics(stderr: string, root: string): DocumentationRender {
  const findings: DocumentationViolation[] = [], noise: string[] = [];
  for (const raw of stderr.split(/\r?\n/)) {
    const text = raw.trim(); if (!text) continue;
    const match = text.match(/^asciidoctor:\s*(?:WARNING|ERROR|FAILED):\s*([^:]+?):\s*(?:line\s*(\d+):\s*)?(.*)$/);
    if (!match) { noise.push(text); continue; }
    const reported = match[1].trim(); let file = reported;
    if (isAbsolute(reported)) file = relative(root, reported).replaceAll("\\", "/");
    // A bare basename remains the renderer's evidence; we never invent a target.
    findings.push(violation("planner.docs.reference-integrity", file, Number(match[2] ?? 1), `asciidoctor: ${match[3]}`));
  }
  return noise.length ? { findings, couldNotCheck: `asciidoctor emitted output it could not attribute to a document, so part of the corpus was not validated: ${noise.join("; ")}` } : { findings };
}

export async function renderDocumentation(root: string, timeoutMs = 120_000): Promise<DocumentationRender> {
  const docsRoot = join(root, DOCS);
  if (!existsSync(docsRoot)) return { findings: [], couldNotCheck: "docs/ is not a readable directory" };
  const tool = Bun.which("asciidoctor");
  if (!tool) return { findings: [], couldNotCheck: "asciidoctor is not installed, so the corpus was not rendered and reference integrity could not be established. This is COULD_NOT_CHECK and it BLOCKS; install the toolchain rather than suppressing it." };
  const sources = (await walk(docsRoot, ".adoc")).filter(path => !relative(docsRoot, path).replaceAll("\\", "/").startsWith("dist/"));
  if (!sources.length) return { findings: [] };
  const output = await mkdtemp(join(tmpdir(), "atdd-docs-render-"));
  try {
    const child = Bun.spawn({ cmd: [tool, "--failure-level", "WARN", "--base-dir", docsRoot, "--destination-dir", output, ...sources], stdout: "pipe", stderr: "pipe" });
    const timed = await Promise.race([child.exited, new Promise<"timeout">(done => setTimeout(() => done("timeout"), timeoutMs))]);
    if (timed === "timeout") { child.kill(); return { findings: [], couldNotCheck: `asciidoctor exceeded ${timeoutMs / 1000}s and was abandoned; the corpus was not rendered` }; }
    const parsed = parseAsciidoctorDiagnostics(await new Response(child.stderr).text(), root);
    if (parsed.couldNotCheck) return parsed;
    if (timed !== 0 && !parsed.findings.length) return { findings: [], couldNotCheck: `asciidoctor failed without saying where: exit status ${timed}` };
    return parsed;
  } catch (error) { return { findings: [], couldNotCheck: `asciidoctor could not be executed: ${String(error)}` }; }
  finally { await rm(output, { recursive: true, force: true }); }
}

async function checkDocumentationInner(input: { root: string; declaration: DocumentationDeclaration | null; changeSet: string[] | null; render?: () => Promise<DocumentationRender> }): Promise<DocumentationCheck> {
  if (input.declaration?.impact === "none") return { verdict: "NOT_APPLICABLE", findings: [], checked: [] };
  const corpus = await scanDocumentation(input.root); const findings: DocumentationCheck["findings"] = [...corpus]; const checked = (await documents(resolve(input.root))).map(d => d.path); let definite = corpus.length > 0;
  if (input.declaration) { const declarationFindings = declarationViolations(input.declaration, input.changeSet ?? undefined, await deliveryRecords(resolve(input.root))); findings.push(...declarationFindings); definite ||= declarationFindings.length > 0; checked.push("<declaration>"); if (input.declaration.impact === "change") for (const artifact of input.declaration.artifacts ?? []) if (["create", "modify"].includes(artifact.action ?? "") && artifact.path && !existsSync(join(input.root, artifact.path))) { findings.push(violation("planner.docs.artifact-path-shape", artifact.path, 1, `declared artifact ${JSON.stringify(artifact.path)} (action: ${artifact.action}) is not in the tree, so it was never examined; a declared document that was never written has not discharged the obligation.`)); definite = true; } } else findings.push({ rule_id: null, where: "<declaration>", message: "core supplied no documentation declaration, so no declaration-dependent rule could be evaluated. This is COULD_NOT_CHECK and it BLOCKS." });
  if (input.declaration && input.changeSet === null) findings.push({ rule_id: null, where: "<change_set>", message: "core supplied no change set, so whether this diff touches docs/ without declaring it could not be established. This is COULD_NOT_CHECK and it BLOCKS." });
  const rendered = await (input.render ?? (() => renderDocumentation(input.root)))(); findings.push(...rendered.findings); definite ||= rendered.findings.length > 0; if (rendered.couldNotCheck) findings.push({ rule_id: "planner.docs.reference-integrity", file: "docs/", line: 1, col: 1, evidence: rendered.couldNotCheck, source_line: "" }); else checked.push("<render:asciidoctor>");
  // Fail closed on any rule id this capability does not declare, however it was built (a renderer can return anything).
  const undeclared = [...new Set(findings.map(f => f.rule_id).filter((id): id is string => id !== null && !(DOC_RULE_IDS as readonly string[]).includes(id)))];
  if (undeclared.length) throw new Error(`documentation capability produced undeclared rule id(s): ${undeclared.join(", ")}. Declare them in DOC_RULE_IDS and the manifest, each with a convention.`);
  return { verdict: definite ? "FAIL" : input.declaration === null || input.changeSet === null || Boolean(rendered.couldNotCheck) ? "COULD_NOT_CHECK" : "PASS", findings, checked };
}

/** A capability crash is never interpreted as a clean documentation result. */
export async function checkDocumentation(input: { root: string; declaration: DocumentationDeclaration | null; changeSet: string[] | null; render?: () => Promise<DocumentationRender> }): Promise<DocumentationCheck> {
  try { return await checkDocumentationInner(input); }
  catch (error) { return { verdict: "FAIL", findings: [{ rule_id: null, where: input.root, message: `the documentation capability raised ${error instanceof Error ? error.name : "Error"}: ${String(error)}. A capability that crashes has not discharged the obligation.` }], checked: [] }; }
}
