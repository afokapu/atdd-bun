import Ajv, { type ValidateFunction } from "ajv";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PlanFinding } from "./planner-kernel";

/** The delivery profile: the record a tranche leaves of its reviews, checked against the policy in atdd-bun.yaml.
 *
 * A tranche is one independently mergeable piece of a program. Its driver appends each review to
 * `<root>/<tranche>/evidence.yaml`; this validator judges that record, never the running agents. It holds on
 * every run: each reviewer is an allowed model, a fallback names why the preferred one was unavailable, the
 * reviewer is independent of the authors, and every finding is fixed, withdrawn after a written dispute, or ruled
 * on by a human. A `ready` record must also have every configured stage approved and an approved SHA that exists.
 * At the merge gate (a pull request or merge queue in CI), every record the branch changes must be ready and the
 * branch head may differ from its approved SHA only under the delivery root.
 *
 * The capability is inert until adopted in atdd-bun.yaml: a `delivery:` block, or `delivery` named in `profiles:`. */

export const STAGES = ["plan_review", "test_review", "code_review", "final_review"] as const;
export type Stage = (typeof STAGES)[number];
export type Independence = "fresh-process" | "different-model";
export type StagePolicy = { authors: string[]; reviewers: string[]; independence: Independence };
export type DeliveryPolicy = {
  root: string;
  independence: Independence;
  stages: Partial<Record<Stage, StagePolicy>>;
  fallback: { after_failures: number; within_minutes: number; when_exhausted: "block" | "wait" };
  commands: Record<string, { author?: string; review?: string }>;
};

type RawStage = { authors?: string[]; reviewers: string[]; independence?: Independence };
type RawDelivery = { root?: string; independence?: Independence; stages?: Partial<Record<Stage, RawStage>>; fallback?: Partial<DeliveryPolicy["fallback"]>; commands?: DeliveryPolicy["commands"] };

const DEFAULT_STAGES: Record<Stage, Omit<StagePolicy, "independence">> = {
  plan_review: { authors: ["codex"], reviewers: ["glm", "claude"] },
  test_review: { authors: ["glm", "claude"], reviewers: ["codex", "claude"] },
  code_review: { authors: ["glm", "claude"], reviewers: ["glm", "claude"] },
  final_review: { authors: ["codex"], reviewers: ["codex", "claude"] },
};
const DEFAULT_FALLBACK: DeliveryPolicy["fallback"] = { after_failures: 3, within_minutes: 10, when_exhausted: "block" };
const packageRoot = resolve(import.meta.dir, "..");

const finding = (rule_id: string, file: string, evidence: string): PlanFinding => ({ rule_id, file, evidence });
const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);

/** Whether a parsed atdd-bun.yaml adopts delivery: named in `profiles:`, or, with no list (every profile active),
 * a `delivery:` block is present. Adoption is a positive act; an upgraded package changes nothing until then. */
export function deliveryAdopted(config: unknown): boolean {
  const data = record(config);
  if (!data) return false;
  return Array.isArray(data.profiles) ? data.profiles.includes("delivery") : data.delivery !== undefined;
}

/** The effective policy: package defaults under whatever the `delivery:` block sets. `stages`, when given,
 * replaces the default stage set, so a stage it omits is not required. */
export function deliveryPolicy(block: unknown): DeliveryPolicy {
  const raw = (record(block) ?? {}) as RawDelivery, independence = raw.independence ?? "fresh-process";
  const stages: DeliveryPolicy["stages"] = {};
  for (const stage of STAGES) {
    const given = raw.stages ? raw.stages[stage] : DEFAULT_STAGES[stage];
    if (!given) continue;
    stages[stage] = { authors: given.authors ?? DEFAULT_STAGES[stage].authors, reviewers: given.reviewers, independence: (given as RawStage).independence ?? independence };
  }
  return { root: raw.root ?? "delivery", independence, stages, fallback: { ...DEFAULT_FALLBACK, ...raw.fallback }, commands: raw.commands ?? {} };
}

/** Why `current` enforces less than `base`, for the integrity check's loosening report. Tightening is silent. */
export function loosenedDelivery(base: unknown, current: unknown): string[] {
  if (!deliveryAdopted(base)) return [];
  // Dropping `delivery` from an explicit profile list is already reported as a dropped profile.
  if (!deliveryAdopted(current)) return Array.isArray(record(current)?.profiles) ? [] : ["delivery is no longer adopted (the delivery: block was removed)"];
  const before = deliveryPolicy(record(base)!.delivery), after = deliveryPolicy(record(current)!.delivery), out: string[] = [];
  for (const stage of STAGES) {
    const b = before.stages[stage], c = after.stages[stage];
    if (!b) continue;
    if (!c) { out.push(`delivery.stages drops ${stage}`); continue; }
    if (b.independence === "different-model" && c.independence === "fresh-process") out.push(`delivery.stages.${stage}.independence different-model → fresh-process`);
    const added = c.reviewers.filter(model => !b.reviewers.includes(model));
    if (added.length) out.push(`delivery.stages.${stage}.reviewers adds ${added.join(", ")}`);
  }
  return out;
}

async function readConfig(root: string): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  const file = join(root, "atdd-bun.yaml");
  if (!existsSync(file)) return { data: null };
  try { return { data: record(Bun.YAML.parse(await readFile(file, "utf8"))) }; } catch (error) { return { data: null, error: String(error) }; }
}

async function schema(name: string): Promise<ValidateFunction> {
  return new Ajv({ allErrors: true, strict: false }).compile(JSON.parse(await readFile(join(packageRoot, "planner-schemas", name), "utf8")));
}

const git = async (cwd: string, args: string[]) => {
  try {
    const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
    return { code: await child.exited, out: (await new Response(child.stdout).text()).trim() };
  } catch { return { code: 1, out: "" }; }
};

type Actor = { model: string; run: string };
type Finding = { id: string; rebuttal?: string; outcome?: "fixed" | "withdrawn" | "human"; decision?: string };
type Review = { stage: Stage; sha: string; author?: Actor; reviewer: Actor; fallback?: Array<{ role?: "author" | "reviewer"; from: string; reason: string }>; verdict: "approve" | "request_changes"; findings?: Finding[] };
type Evidence = { tranche: string; status: "open" | "ready"; base_sha: string; approved_sha?: string; reviews: Review[] };
export type EvidenceFile = { file: string; tranche: string; data: Evidence | null; error?: string };

/** Every tranche folder under the delivery root with its parsed evidence, or why it has none. */
export async function loadEvidence(root: string, policy: DeliveryPolicy): Promise<EvidenceFile[]> {
  const dir = join(root, policy.root);
  if (!existsSync(dir)) return [];
  const out: EvidenceFile[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = `${policy.root}/${entry.name}/evidence.yaml`, path = join(root, file);
    if (!existsSync(path)) { out.push({ file, tranche: entry.name, data: null, error: `tranche folder ${policy.root}/${entry.name} has no evidence.yaml` }); continue; }
    try { out.push({ file, tranche: entry.name, data: Bun.YAML.parse(await readFile(path, "utf8")) as Evidence }); }
    catch (error) { out.push({ file, tranche: entry.name, data: null, error: `could not parse ${file}: ${String(error)}` }); }
  }
  return out;
}

/** Models must come from the stage's list; a model after the first needs a recorded fallback from each one before it. */
function checkModels(file: string, review: Review, policy: StagePolicy, at: string): PlanFinding[] {
  const out: PlanFinding[] = [];
  const role = (name: "author" | "reviewer", actor: Actor | undefined, list: string[]) => {
    if (!actor) return;
    const index = list.indexOf(actor.model);
    if (index < 0) { out.push(finding("delivery.model-allowed", file, `${at}: ${name} model '${actor.model}' is not in ${review.stage}.${name}s [${list.join(", ")}]`)); return; }
    const recorded = (review.fallback ?? []).filter(entry => (entry.role ?? "reviewer") === name).map(entry => entry.from);
    for (const skipped of list.slice(0, index)) if (!recorded.includes(skipped)) out.push(finding("delivery.model-allowed", file, `${at}: ${name} '${actor.model}' is a fallback, but no fallback from '${skipped}' records why it was unavailable`));
    for (const from of recorded) if (!list.slice(0, index).includes(from)) out.push(finding("delivery.model-allowed", file, `${at}: ${name} fallback from '${from}' does not precede '${actor.model}' in [${list.join(", ")}]`));
  };
  role("author", review.author, policy.authors);
  role("reviewer", review.reviewer, policy.reviewers);
  return out;
}

/** The judgement over one well-formed record. */
function checkEvidence(file: string, evidence: Evidence, policy: DeliveryPolicy): PlanFinding[] {
  const out: PlanFinding[] = [], reviews = evidence.reviews;
  const authorRuns = new Set(reviews.flatMap(review => review.author ? [review.author.run] : [])), reviewerRuns = new Map<string, number>();
  reviews.forEach((review, index) => {
    const at = `reviews[${index}] (${review.stage} @ ${review.sha})`, stage = policy.stages[review.stage];
    if (!stage) { out.push(finding("delivery.evidence-schema", file, `${at}: ${review.stage} is not a configured stage in delivery.stages`)); return; }
    if (!review.author) out.push(finding("delivery.evidence-schema", file, `${at}: names no author; the reviewer's independence cannot be judged without one`));
    out.push(...checkModels(file, review, stage, at));
    if (authorRuns.has(review.reviewer.run)) out.push(finding("delivery.reviewer-independent", file, `${at}: reviewer run '${review.reviewer.run}' also authored in this tranche; a reviewer that edits becomes an author`));
    if (reviewerRuns.has(review.reviewer.run)) out.push(finding("delivery.reviewer-independent", file, `${at}: reviewer run '${review.reviewer.run}' already reviewed reviews[${reviewerRuns.get(review.reviewer.run)}]; every review is a fresh process`));
    else reviewerRuns.set(review.reviewer.run, index);
    if (stage.independence === "different-model" && review.author && review.author.model === review.reviewer.model) out.push(finding("delivery.reviewer-independent", file, `${at}: ${review.stage} requires a different model, but '${review.reviewer.model}' reviewed its own model's work`));
  });

  // Findings: each one on a request-changes review is fixed, withdrawn after one written dispute, or ruled on by a
  // human, once the stage has moved on (a later review of it exists) or the record is ready.
  reviews.forEach((review, index) => {
    if (review.verdict !== "request_changes") return;
    const later = reviews.slice(index + 1).filter(next => next.stage === review.stage);
    for (const item of review.findings ?? []) {
      const at = `reviews[${index}] (${review.stage}) finding ${item.id}`, upheld = later.some(next => (next.findings ?? []).some(other => other.id === item.id));
      if (!item.outcome) { if (later.length || evidence.status === "ready") out.push(finding("delivery.findings-resolved", file, `${at} has no outcome; record fixed, withdrawn (after a rebuttal) or human (with the decision)`)); continue; }
      if (item.outcome !== "human" && !later.length) out.push(finding("delivery.findings-resolved", file, `${at} is ${item.outcome}, but no later ${review.stage} confirms it; a fresh reviewer re-reviews every repair and every dispute`));
      if (item.outcome === "withdrawn" && !item.rebuttal) out.push(finding("delivery.findings-resolved", file, `${at} is withdrawn without a rebuttal; only a written dispute with evidence can withdraw a finding`));
      if (item.outcome === "withdrawn" && upheld) out.push(finding("delivery.findings-resolved", file, `${at} is withdrawn, but a later ${review.stage} raises it again; an upheld dispute goes to a human`));
      if (item.outcome === "human" && !item.decision) out.push(finding("delivery.findings-resolved", file, `${at} is resolved by a human but records no decision`));
    }
  });
  const disputes = new Map<string, { rounds: number; human: boolean; stage: Stage }>();
  for (const review of reviews) for (const item of review.findings ?? []) {
    const key = `${review.stage}/${item.id}`, entry = disputes.get(key) ?? { rounds: 0, human: false, stage: review.stage };
    entry.rounds += item.rebuttal ? 1 : 0; entry.human ||= item.outcome === "human"; disputes.set(key, entry);
  }
  for (const [key, entry] of disputes) if (entry.rounds > 1 && !entry.human) out.push(finding("delivery.findings-resolved", file, `finding ${key} was disputed ${entry.rounds} times; after one round a disputed finding goes to a human (outcome: human, with the decision)`));

  if (evidence.status === "ready") {
    const configured = STAGES.filter(stage => policy.stages[stage]);
    for (const stage of configured) {
      const last = reviews.filter(review => review.stage === stage).at(-1);
      if (!last) out.push(finding("delivery.stages-complete", file, `status is ready, but ${stage} has no review`));
      else if (last.verdict !== "approve") out.push(finding("delivery.stages-complete", file, `status is ready, but the last ${stage} requests changes`));
    }
    const closing = configured.at(-1), approval = closing && reviews.filter(review => review.stage === closing).at(-1);
    if (approval && approval.verdict === "approve" && approval.sha !== evidence.approved_sha) out.push(finding("delivery.stages-complete", file, `approved_sha ${evidence.approved_sha} is not the SHA the last ${closing} approved (${approval.sha})`));
  }
  return out;
}

/** The merge gate: ATDD_DELIVERY_GATE=merge, which the generated CI sets on pull requests and the merge queue.
 * Explicit rather than inferred from the CI event, so a repository's own tests are never judged as tranches. */
export function atMergeGate(env: Record<string, string | undefined> = process.env): boolean {
  return env.ATDD_DELIVERY_GATE === "merge";
}

/** The commits the gate compares: a merge checkout (pull request, merge queue) is judged as base = first parent,
 * head = second parent; otherwise HEAD against the configured base ref. */
async function gateRange(root: string, base?: string): Promise<{ base: string; head: string } | null> {
  const merge = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD^2"]);
  if (!merge.code && merge.out) return { base: (await git(root, ["rev-parse", "HEAD^1"])).out, head: merge.out };
  const ref = base ?? process.env.ATDD_BASE_REF ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/HEAD");
  if ((await git(root, ["rev-parse", "--verify", "--quiet", ref])).code) return null;
  const since = (await git(root, ["merge-base", "HEAD", ref])).out, head = (await git(root, ["rev-parse", "HEAD"])).out;
  return since && head ? { base: since, head } : null;
}

export type DeliveryOptions = { gate?: boolean; base?: string };

export async function validateDelivery(root = process.cwd(), options: DeliveryOptions = {}): Promise<PlanFinding[]> {
  const absolute = resolve(root), config = await readConfig(absolute);
  if (config.error || !deliveryAdopted(config.data)) return [];
  const findings: PlanFinding[] = [], validConfig = await schema("delivery-config.schema.json"), block = config.data!.delivery ?? {};
  let policy = deliveryPolicy(block);
  if (!validConfig(block)) {
    for (const error of validConfig.errors ?? []) findings.push(finding("delivery.config-schema", "atdd-bun.yaml", `delivery${error.instancePath.replaceAll("/", ".")} ${error.message ?? error.keyword}`));
    policy = deliveryPolicy({});
  }
  const validEvidence = await schema("delivery-evidence.schema.json"), files = await loadEvidence(absolute, policy), ready: EvidenceFile[] = [];
  for (const entry of files) {
    if (!entry.data) { findings.push(finding("delivery.evidence-schema", entry.file, entry.error ?? "evidence is missing")); continue; }
    if (!validEvidence(entry.data)) {
      for (const error of validEvidence.errors ?? []) findings.push(finding("delivery.evidence-schema", entry.file, `${entry.file} violates delivery-evidence.schema.json: ${error.instancePath || "/"} ${error.message ?? error.keyword}`));
      continue;
    }
    if (entry.data.tranche !== entry.tranche) findings.push(finding("delivery.evidence-schema", entry.file, `tranche '${entry.data.tranche}' does not match its folder '${entry.tranche}'`));
    findings.push(...checkEvidence(entry.file, entry.data, policy));
    if (entry.data.status === "ready") {
      ready.push(entry);
      if ((await git(absolute, ["cat-file", "-e", `${entry.data.approved_sha}^{commit}`])).code) findings.push(finding("delivery.approved-sha-resolves", entry.file, `approved_sha ${entry.data.approved_sha} is not a commit in this repository's history`));
    }
  }
  if (options.gate ?? atMergeGate()) findings.push(...await mergeGate(absolute, policy, files, options.base));
  return findings;
}

/** Every record the branch changes must be ready, and the head may differ from its approved SHA only under the
 * delivery root: the evidence commit itself is the one change allowed after approval. */
async function mergeGate(root: string, policy: DeliveryPolicy, files: EvidenceFile[], base?: string): Promise<PlanFinding[]> {
  const range = await gateRange(root, base);
  if (!range) return [finding("delivery.merge-gate", "atdd-bun.yaml", "the merge gate cannot resolve the base branch; fetch full history (fetch-depth: 0) or set ATDD_BASE_REF")];
  const changed = (await git(root, ["diff", "--relative", "--name-only", `${range.base}...${range.head}`, "--", policy.root])).out.split("\n").filter(path => path.endsWith("/evidence.yaml"));
  // Drift is judged over the whole repository, not just this root: a change anywhere after approval counts.
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).out, out: PlanFinding[] = [];
  for (const path of changed) {
    const entry = files.find(file => file.file === path);
    if (!entry?.data) continue; // removed, or already reported by the schema rule
    if (entry.data.status !== "ready") { out.push(finding("delivery.merge-gate", path, `${path} is ${entry.data.status}; a tranche merges only when its record is ready`)); continue; }
    const sha = entry.data.approved_sha!;
    if ((await git(root, ["cat-file", "-e", `${sha}^{commit}`])).code) continue; // reported by delivery.approved-sha-resolves
    const drift = (await git(root, ["diff", "--name-only", sha, range.head])).out.split("\n").filter(Boolean).filter(file => !file.startsWith(`${prefix}${policy.root}/`));
    if (drift.length) out.push(finding("delivery.merge-gate", path, `the branch head changes ${drift.slice(0, 5).join(", ")}${drift.length > 5 ? ` and ${drift.length - 5} more` : ""} after approved_sha ${sha.slice(0, 7)}; any change after approval needs a fresh review`));
  }
  return out;
}
