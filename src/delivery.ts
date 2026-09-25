import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { existsSync, lstatSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PlanFinding } from "./planner-kernel";
import { topologyFor } from "./topology";

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
  require_record: boolean;
  multiplexer: string;
};


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
  // Every value is type-guarded: a malformed block is the config-schema rule's to report, never a crash here (the
  // validator and the integrity check both read the policy through this function). A wrong-typed value falls back
  // to its default.
  const raw = record(block) ?? {}, text = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);
  const models = (value: unknown, fallback: string[]) => (Array.isArray(value) && value.every(item => typeof item === "string") ? value as string[] : fallback);
  const mode = (value: unknown, fallback: Independence): Independence => (value === "fresh-process" || value === "different-model" ? value : fallback);
  const count = (value: unknown, fallback: number) => (Number.isInteger(value) ? value as number : fallback);
  const independence = mode(raw.independence, "fresh-process"), given = record(raw.stages), stages: DeliveryPolicy["stages"] = {};
  for (const stage of STAGES) {
    const entry = given ? record(given[stage]) : DEFAULT_STAGES[stage];
    if (!entry) continue;
    stages[stage] = { authors: models(entry.authors, DEFAULT_STAGES[stage].authors), reviewers: models(entry.reviewers, DEFAULT_STAGES[stage].reviewers), independence: mode((entry as Record<string, unknown>).independence, independence) };
  }
  const fallback = record(raw.fallback) ?? {};
  return {
    root: canonicalRoot(text(raw.root, "delivery")), independence, stages,
    fallback: { after_failures: count(fallback.after_failures, DEFAULT_FALLBACK.after_failures), within_minutes: count(fallback.within_minutes, DEFAULT_FALLBACK.within_minutes), when_exhausted: fallback.when_exhausted === "wait" ? "wait" : "block" },
    commands: (record(raw.commands) ?? {}) as DeliveryPolicy["commands"], require_record: raw.require_record === false ? false : true, multiplexer: text(raw.multiplexer, "herdr"),
  };
}

/** One spelling per root, so filesystem discovery, Git pathspecs and drift filtering agree ("delivery/" is "delivery"). */
export const canonicalRoot = (root: string) => root.replaceAll("\\", "/").split("/").filter(part => part && part !== ".").join("/") || "delivery";

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
    for (const role of ["reviewers", "authors"] as const) {
      const added = c[role].filter(model => !b[role].includes(model));
      if (added.length) out.push(`delivery.stages.${stage}.${role} adds ${added.join(", ")}`);
      // The lists are preference orders: moving a model earlier, by reordering or removing one before it, makes a
      // fallback model usable without the fallback.
      const promoted = c[role].filter(model => b[role].includes(model) && c[role].indexOf(model) < b[role].indexOf(model));
      if (promoted.length) out.push(`delivery.stages.${stage}.${role} [${b[role].join(", ")}] → [${c[role].join(", ")}] promotes ${promoted.join(", ")}`);
    }
  }
  // Moving the root hides every earlier record from the validator and the gate.
  if (before.root !== after.root) out.push(`delivery.root ${before.root} → ${after.root}`);
  if (before.require_record && !after.require_record) out.push("delivery.require_record true → false");
  if (after.fallback.after_failures < before.fallback.after_failures) out.push(`delivery.fallback.after_failures ${before.fallback.after_failures} → ${after.fallback.after_failures}`);
  if (after.fallback.within_minutes > before.fallback.within_minutes) out.push(`delivery.fallback.within_minutes ${before.fallback.within_minutes} → ${after.fallback.within_minutes}`);
  return out;
}

async function readConfig(root: string): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  const file = join(root, "atdd-bun.yaml");
  if (!existsSync(file)) return { data: null };
  try { return { data: record(Bun.YAML.parse(await readFile(file, "utf8"))) }; } catch (error) { return { data: null, error: String(error) }; }
}

async function schema(name: string): Promise<ValidateFunction> {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(await readFile(join(packageRoot, "planner-schemas", name), "utf8")));
}

const git = async (cwd: string, args: string[]) => {
  try {
    const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
    return { code: await child.exited, out: (await new Response(child.stdout).text()).trim() };
  } catch { return { code: 1, out: "" }; }
};

type Actor = { model: string; run: string };
type Review = { stage: Stage; sha: string; author?: Actor; reviewer: Actor; fallback?: Array<{ role?: "author" | "reviewer"; from: string; kind: string; failures: number; window: { from: string; to: string }; reason: string }>; verdict: "approve" | "request_changes"; findings?: Finding[]; report?: string };
type Finding = { id: string; severity: string; rebuttal?: string; outcome?: "fixed" | "withdrawn" | "human"; decision?: string };
type Evidence = { tranche: string; status: "open" | "ready"; base_sha: string; approved_sha?: string; reviews: Review[] };
export type EvidenceFile = { file: string; tranche: string; data: Evidence | null; error?: string };

/** Every tranche folder under the delivery root with its parsed evidence, or why it has none. */
export async function loadEvidence(root: string, policy: DeliveryPolicy): Promise<EvidenceFile[]> {
  const dir = join(root, policy.root);
  if (!existsSync(dir)) return [];
  const out: EvidenceFile[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory() || entry.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name))) {
    // A symlinked tranche folder could point anywhere, and would otherwise be skipped unread.
    if (entry.isSymbolicLink()) { out.push({ file: `${policy.root}/${entry.name}`, tranche: entry.name, data: null, error: `${policy.root}/${entry.name} is a symlink; a tranche folder is a real folder holding its own evidence.yaml` }); continue; }
    const file = `${policy.root}/${entry.name}/evidence.yaml`, path = join(root, file);
    if (!existsSync(path)) { out.push({ file, tranche: entry.name, data: null, error: `tranche folder ${policy.root}/${entry.name} has no evidence.yaml` }); continue; }
    try { out.push({ file, tranche: entry.name, data: Bun.YAML.parse(await readFile(path, "utf8")) as Evidence }); }
    catch (error) { out.push({ file, tranche: entry.name, data: null, error: `could not parse ${file}: ${String(error)}` }); }
  }
  return out;
}

/** Models must come from the stage's list; a model after the first needs a recorded fallback from each one before it. */
function checkModels(file: string, review: Review, policy: StagePolicy, at: string, fallback: DeliveryPolicy["fallback"]): PlanFinding[] {
  const out: PlanFinding[] = [];
  // The count and window are the driver's claims, but explicit ones: a fallback outside the policy is out of policy.
  for (const entry of review.fallback ?? []) {
    if (entry.failures < fallback.after_failures) out.push(finding("delivery.model-allowed", file, `${at}: fallback from '${entry.from}' after ${entry.failures} failure(s); the policy requires ${fallback.after_failures} (delivery.fallback.after_failures)`));
    const span = (Date.parse(entry.window.to) - Date.parse(entry.window.from)) / 60_000;
    if (!(span >= 0)) out.push(finding("delivery.model-allowed", file, `${at}: fallback from '${entry.from}' has a window that ends before it starts`));
    else if (span > fallback.within_minutes) out.push(finding("delivery.model-allowed", file, `${at}: fallback from '${entry.from}' counts failures over ${Math.round(span)} minutes; the policy allows ${fallback.within_minutes} (delivery.fallback.within_minutes)`));
  }
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

/** Reports are data, never code: a report path is exempt from drift, so it must not be able to name a source file. */
const REPORT_EXTENSION = /\.(json|jsonl|yaml|yml|txt|md|log)$/;
const regularFile = (path: string) => { try { return lstatSync(path).isFile(); } catch { return false; } };

/** Two spellings of one commit: an abbreviated SHA is a prefix of the full one. */
const sameCommit = (a: string, b: string) => a.length <= b.length ? b.startsWith(a) : a.startsWith(b);

/** The judgement over one well-formed record. */
function checkEvidence(file: string, evidence: Evidence, policy: DeliveryPolicy): PlanFinding[] {
  const out: PlanFinding[] = [], reviews = evidence.reviews;
  const authorRuns = new Set(reviews.flatMap(review => review.author ? [review.author.run] : [])), reviewerRuns = new Map<string, number>();
  reviews.forEach((review, index) => {
    const at = `reviews[${index}] (${review.stage} @ ${review.sha})`, stage = policy.stages[review.stage];
    if (!stage) { out.push(finding("delivery.evidence-schema", file, `${at}: ${review.stage} is not a configured stage in delivery.stages`)); return; }
    if (!review.author) out.push(finding("delivery.evidence-schema", file, `${at}: names no author; the reviewer's independence cannot be judged without one`));
    out.push(...checkModels(file, review, stage, at, policy.fallback));
    if (authorRuns.has(review.reviewer.run)) out.push(finding("delivery.reviewer-independent", file, `${at}: reviewer run '${review.reviewer.run}' also authored in this tranche; a reviewer that edits becomes an author`));
    if (reviewerRuns.has(review.reviewer.run)) out.push(finding("delivery.reviewer-independent", file, `${at}: reviewer run '${review.reviewer.run}' already reviewed reviews[${reviewerRuns.get(review.reviewer.run)}]; every review is a fresh process`));
    else reviewerRuns.set(review.reviewer.run, index);
    if (stage.independence === "different-model" && review.author && review.author.model === review.reviewer.model) out.push(finding("delivery.reviewer-independent", file, `${at}: ${review.stage} requires a different model, but '${review.reviewer.model}' reviewed its own model's work`));
  });

  // Findings: each one on a request-changes review is fixed, withdrawn after one written dispute, or ruled on by a
  // human, once the stage has moved on (a later review of it exists) or the record is ready.
  reviews.forEach((review, index) => {
    if (review.verdict === "approve") {
      for (const item of review.findings ?? []) if (item.severity === "critical" || item.severity === "high") out.push(finding("delivery.findings-resolved", file, `reviews[${index}] (${review.stage}) approves with ${item.severity} finding ${item.id}; a critical or high finding requests changes`));
      return;
    }
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
    if (approval && approval.verdict === "approve" && !sameCommit(approval.sha, evidence.approved_sha ?? "")) out.push(finding("delivery.stages-complete", file, `approved_sha ${evidence.approved_sha} is not the SHA the last ${closing} approved (${approval.sha})`));
  }
  return out;
}

export type GateMode = "merge" | "post-merge";
/** The gate: ATDD_DELIVERY_GATE, which the generated CI sets to `merge` on pull requests and the merge queue and to
 * `post-merge` on pushes to the base branch. Explicit rather than inferred from the CI event, so a repository's own
 * tests are never judged as tranches. */
export function gateMode(env: Record<string, string | undefined> = process.env): GateMode | null {
  return env.ATDD_DELIVERY_GATE === "merge" || env.ATDD_DELIVERY_GATE === "post-merge" ? env.ATDD_DELIVERY_GATE : null;
}

/** The commits the gate compares: a merge checkout (pull request, merge queue) is judged as base = first parent,
 * head = second parent; otherwise HEAD against the configured base ref. */
async function gateRange(root: string, mode: GateMode, base?: string): Promise<{ base: string; head: string } | null> {
  // After the merge, the pushed commit is judged against its first parent: what this push brought in.
  // With the push's before-SHA (the generated CI passes it as ATDD_BASE_REF), everything the push brought in is judged,
  // not only its last commit; a new branch's first push (all zeros) falls back to the first parent.
  if (mode === "post-merge") {
    const head = (await git(root, ["rev-parse", "HEAD"])).out, before = base ?? process.env.ATDD_BASE_REF;
    if (before && !/^0+$/.test(before)) {
      const resolved = await git(root, ["rev-parse", "--verify", "--quiet", `${before}^{commit}`]);
      if (!resolved.code && resolved.out) return { base: resolved.out, head };
    }
    const parent = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD^1"]);
    return parent.code || !parent.out ? null : { base: parent.out, head };
  }
  // An explicit base wins: a branch that merged its base in locally is still judged against that base.
  const explicit = base ?? process.env.ATDD_BASE_REF;
  if (explicit && !(await git(root, ["rev-parse", "--verify", "--quiet", explicit])).code) return againstRef(root, explicit);
  // CI checks a pull request out as a merge commit: first parent the base, second the tranche head.
  const merge = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD^2"]);
  if (!merge.code && merge.out) return { base: (await git(root, ["rev-parse", "HEAD^1"])).out, head: merge.out };
  const ref = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/HEAD";
  return (await git(root, ["rev-parse", "--verify", "--quiet", ref])).code ? null : againstRef(root, ref);
}

async function againstRef(root: string, ref: string): Promise<{ base: string; head: string } | null> {
  const since = (await git(root, ["merge-base", "HEAD", ref])).out, head = (await git(root, ["rev-parse", "HEAD"])).out;
  return since && head ? { base: since, head } : null;
}

/** `gate: true` is the pre-merge gate; `false` disables it; unset reads ATDD_DELIVERY_GATE. */
export type DeliveryOptions = { gate?: boolean | GateMode; base?: string };

export async function validateDelivery(root = process.cwd(), options: DeliveryOptions = {}): Promise<PlanFinding[]> {
  const absolute = resolve(root), config = await readConfig(absolute);
  if (config.error) return [finding("delivery.config-schema", "atdd-bun.yaml", `atdd-bun.yaml could not be parsed, so the delivery policy cannot be read: ${config.error}`)];
  if (!deliveryAdopted(config.data)) return [];
  const findings: PlanFinding[] = [], validConfig = await schema("delivery-config.schema.json"), block = "delivery" in config.data! ? config.data!.delivery : {};
  let policy = deliveryPolicy(block);
  if (!validConfig(block)) {
    for (const error of validConfig.errors ?? []) findings.push(finding("delivery.config-schema", "atdd-bun.yaml", `delivery${error.instancePath.replaceAll("/", ".")} ${error.message ?? error.keyword}`));
    policy = deliveryPolicy({});
  }
  // The root is an evidence namespace only. Overlapping a plan, source, test, e2e or telemetry root would let a product
  // file be labelled a report and escape review; such a root is reported, and the default is used instead.
  const topology = await topologyFor(absolute), owned = [topology.planRoot, topology.sourceRoot, topology.testRoot, topology.e2eRoot, topology.telemetryRoot];
  const overlap = owned.find(other => policy.root === other || policy.root.startsWith(`${other}/`) || other.startsWith(`${policy.root}/`));
  if (overlap) {
    findings.push(finding("delivery.config-schema", "atdd-bun.yaml", `delivery.root ${policy.root} overlaps the ${overlap} root; the delivery root holds only records and reports`));
    policy = { ...policy, root: "delivery" };
  }
  const validEvidence = await schema("delivery-evidence.schema.json"), files = await loadEvidence(absolute, policy);
  const mode = options.gate === undefined ? gateMode() : options.gate === true ? "merge" : options.gate || null;
  // At the gate, a record the change does not touch was judged when it merged. It is not judged again, against a
  // later policy, schema or history: records are append-only and could never be repaired, so one tightening would
  // fail every later change. Outside the gate every record is judged. The gate itself still rejects any change to
  // an untouched record's folder (mergeGate).
  const onBase = mode ? (await gateRange(absolute, mode, options.base))?.base ?? null : null;
  for (const entry of files) {
    if (onBase && existsSync(join(absolute, entry.file)) && !(await git(absolute, ["diff", "--quiet", onBase, "--", `${policy.root}/${entry.tranche}`])).code) continue;
    if (!entry.data) { findings.push(finding("delivery.evidence-schema", entry.file, entry.error ?? "evidence is missing")); continue; }
    if (!validEvidence(entry.data)) {
      for (const error of validEvidence.errors ?? []) findings.push(finding("delivery.evidence-schema", entry.file, `${entry.file} violates delivery-evidence.schema.json: ${error.instancePath || "/"} ${error.message ?? error.keyword}`));
      continue;
    }
    if (entry.data.tranche !== entry.tranche) findings.push(finding("delivery.evidence-schema", entry.file, `tranche '${entry.data.tranche}' does not match its folder '${entry.tranche}'`));
    // A report lives in its tranche's folder: a report path is exempt from drift, so it may never name other files.
    const folder = `${policy.root}/${entry.tranche}/`;
    const seen = new Map<string, number>();
    for (const [index, review] of entry.data.reviews.entries()) {
      if (review.report === undefined) continue;
      if (!(review.report.startsWith(folder) && review.report !== entry.file && review.report.split("/").every(part => part && part !== "." && part !== "..") && REPORT_EXTENSION.test(review.report)))
        findings.push(finding("delivery.evidence-schema", entry.file, `reviews[${index}] report ${review.report} must be a data file (${REPORT_EXTENSION.source.slice(3, -2).replaceAll("|", ", ")}) inside ${folder}, other than evidence.yaml`));
      // Each review retains its own raw output: one file cannot stand for several reviews.
      if (seen.has(review.report)) findings.push(finding("delivery.evidence-schema", entry.file, `reviews[${index}] reuses report ${review.report} from reviews[${seen.get(review.report)}]; every review retains its own report`));
      else seen.set(review.report, index);
    }
    findings.push(...checkEvidence(entry.file, entry.data, policy));
    if (entry.data.status === "ready") {
      // Ready means auditable: every review's raw output is retained and named.
      for (const [index, review] of entry.data.reviews.entries()) if (!review.report || !regularFile(join(absolute, review.report))) findings.push(finding("delivery.stages-complete", entry.file, `status is ready, but reviews[${index}] (${review.stage}) ${review.report ? `names report ${review.report}, which is not a regular file` : "retains no report"}`));
      if ((await git(absolute, ["cat-file", "-e", `${entry.data.approved_sha}^{commit}`])).code) { findings.push(finding("delivery.approved-sha-resolves", entry.file, `approved_sha ${entry.data.approved_sha} is not a commit in this repository's history`)); continue; }
      // Every stage's approval names a real commit in the approved history, in lifecycle order.
      let previous: { stage: Stage; sha: string } | null = null;
      for (const stage of STAGES.filter(name => policy.stages[name])) {
        const last = entry.data.reviews.filter(review => review.stage === stage).at(-1);
        if (!last || last.verdict !== "approve") continue; // reported by delivery.stages-complete
        if ((await git(absolute, ["cat-file", "-e", `${last.sha}^{commit}`])).code) { findings.push(finding("delivery.approved-sha-resolves", entry.file, `${stage} approved ${last.sha}, which is not a commit in this repository's history`)); continue; }
        if ((await git(absolute, ["merge-base", "--is-ancestor", last.sha, entry.data.approved_sha!])).code) { findings.push(finding("delivery.approved-sha-resolves", entry.file, `${stage} approved ${last.sha.slice(0, 7)}, which is not in the history of approved_sha ${entry.data.approved_sha!.slice(0, 7)}`)); continue; }
        if (previous && (await git(absolute, ["merge-base", "--is-ancestor", previous.sha, last.sha])).code) findings.push(finding("delivery.approved-sha-resolves", entry.file, `${stage} approved ${last.sha.slice(0, 7)}, which does not contain what ${previous.stage} approved (${previous.sha.slice(0, 7)}); stages follow the lifecycle`));
        previous = { stage, sha: last.sha };
      }
      // The closing review does not replace the stage before it: code that changed after that stage approved must go
      // back through it (driver step 5), so nothing outside the delivery root may differ between the two.
      const configured = STAGES.filter(name => policy.stages[name]), before = configured.at(-2), closing = configured.at(-1);
      const earlier = before && entry.data.reviews.filter(review => review.stage === before).at(-1);
      if (earlier && earlier.verdict === "approve" && closing && !(await git(absolute, ["cat-file", "-e", `${earlier.sha}^{commit}`])).code) {
        const changedSince = (await git(absolute, ["diff", "--no-renames", "--name-only", earlier.sha, entry.data.approved_sha!, "--", ":(top)", `:(exclude)${policy.root}`])).out.split("\n").filter(Boolean);
        if (changedSince.length) findings.push(finding("delivery.stages-complete", entry.file, `${changedSince.slice(0, 5).join(", ")}${changedSince.length > 5 ? ` and ${changedSince.length - 5} more` : ""} changed after ${before} approved ${earlier.sha.slice(0, 7)}, and only ${closing} reviewed the change; a code change goes back through ${before}`));
      }
    }
  }
  if (mode) findings.push(...await mergeGate(absolute, policy, files, mode, options.base));
  return findings;
}

/** Every record the branch changes must be ready and approve a commit the head contains, the head may differ from
 * that commit only under the delivery root, and (require_record) a change outside the root needs a record at all.
 * Post-merge, the pushed commit must still contain the approved one: a squash or rebase merge rewrites it. */
async function mergeGate(root: string, policy: DeliveryPolicy, files: EvidenceFile[], mode: GateMode, base?: string): Promise<PlanFinding[]> {
  const range = await gateRange(root, mode, base);
  if (!range) return [finding("delivery.merge-gate", "atdd-bun.yaml", "the merge gate cannot resolve the base branch; fetch full history (fetch-depth: 0) or set ATDD_BASE_REF")];
  const span = mode === "merge" ? [`${range.base}...${range.head}`] : [range.base, range.head];
  const changedHere = (await git(root, ["diff", "--no-renames", "--relative", "--name-only", ...span])).out.split("\n").filter(Boolean);
  // A record is exactly <root>/<tranche>/evidence.yaml and was loaded: an evidence.yaml at any other depth, or a
  // deleted one (reported below), never counts as the record that covers a change.
  const isRecord = (path: string) => path.split("/").length === policy.root.split("/").length + 2 && path.startsWith(`${policy.root}/`) && path.endsWith("/evidence.yaml");
  const changed = changedHere.filter(path => isRecord(path) && files.some(file => file.file === path && file.data)), outside = changedHere.filter(path => !path.startsWith(`${policy.root}/`));
  // Drift is judged over the whole repository, not just this root: a change anywhere after approval counts.
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).out, out: PlanFinding[] = [];
  const inRange = new Set((await git(root, ["diff", "--no-renames", "--name-only", ...span])).out.split("\n").filter(Boolean));
  const deleted = (await git(root, ["diff", "--no-renames", "--relative", "--name-only", "--diff-filter=D", ...span, "--", policy.root])).out.split("\n").filter(path => path.endsWith("/evidence.yaml"));
  for (const path of deleted) out.push(finding("delivery.merge-gate", path, `${mode === "merge" ? "the branch" : "this push"} deletes ${path}; records are append-only, and deleting one would escape its findings and the gate`));
  // A record or report already on the base branch is final: editing an old record would make its reports "named by a
  // changed record" and so exempt from drift. A later change to a tranche is a new tranche with its own record.
  const final = (await git(root, ["diff", "--no-renames", "--relative", "--name-only", "--diff-filter=MRTC", ...span, "--", policy.root])).out.split("\n").filter(Boolean);
  for (const path of final) out.push(finding("delivery.merge-gate", path, `${mode === "merge" ? "the branch" : "this push"} modifies ${path}, which is already on the base branch; merged records and reports are final, so a later change needs a new tranche`));
  // Under the root, only records and the reports a changed record names may change: anything else is unbound.
  const named = new Set(changed.flatMap(path => files.find(file => file.file === path)?.data?.reviews?.flatMap(review => review.report ? [review.report] : []) ?? []));
  for (const path of changedHere.filter(path => path.startsWith(`${policy.root}/`) && !isRecord(path) && !named.has(path)))
    out.push(finding("delivery.merge-gate", path, `${mode === "merge" ? "the branch" : "this push"} changes ${path} under ${policy.root}/, and no record it changes names it as a report; only <tranche>/evidence.yaml records and their reports live there`));
  if (policy.require_record && outside.length && !changed.length) out.push(finding("delivery.merge-gate", "atdd-bun.yaml", `${mode === "merge" ? "the branch" : "this push"} changes ${outside.slice(0, 5).join(", ")}${outside.length > 5 ? ` and ${outside.length - 5} more` : ""} with no tranche record under ${policy.root}/; every change merges through a reviewed tranche (delivery.require_record)`));
  // Every changed ready record, its reports, and the approved SHAs that may cover each other's files.
  const readyChanged = changed.map(path => files.find(file => file.file === path)!).filter(entry => entry.data?.status === "ready");
  const siblings = readyChanged.map(entry => entry.data!.approved_sha!).filter(Boolean);
  const allEvidence = new Set(readyChanged.flatMap(entry => [entry.file, ...entry.data!.reviews.flatMap(review => review.report ? [review.report] : [])]).map(file => `${prefix}${file}`));
  for (const path of changed) {
    const entry = files.find(file => file.file === path);
    if (!entry?.data) continue; // deleted (reported above), or already reported by the schema rule
    if (entry.data.status !== "ready") { out.push(finding("delivery.merge-gate", path, `${path} is ${entry.data.status}; a tranche merges only when its record is ready`)); continue; }
    const sha = entry.data.approved_sha!;
    if ((await git(root, ["cat-file", "-e", `${sha}^{commit}`])).code) continue; // reported by delivery.approved-sha-resolves
    if ((await git(root, ["merge-base", "--is-ancestor", sha, range.head])).code) { out.push(finding("delivery.merge-gate", path, `approved_sha ${sha.slice(0, 7)} is not contained in ${mode === "merge" ? "the branch head" : "the merged commit"}${mode === "post-merge" ? "; a squash or rebase merge rewrites the approved commit, so merge with a merge commit" : "; the branch was rewritten after approval"}`)); continue; }
    // Only the record and the reports it names may postdate the approval; anything else under the root is drift too.
    const exempt = new Set([path, ...entry.data.reviews.flatMap(review => review.report ? [review.report] : [])].map(file => `${prefix}${file}`));
    // Drift: what this change brings in that differs from the approved commit. After a merge commit, the tranche's
    // side is the second parent; a direct push is judged at its head. Intersecting with the change's own files keeps
    // other tranches merged since the approval out of it.
    const merged = mode === "post-merge" ? await git(root, ["rev-parse", "--verify", "--quiet", `${range.head}^2`]) : { code: 1, out: "" };
    const tip = !merged.code && merged.out && !(await git(root, ["merge-base", "--is-ancestor", sha, merged.out])).code ? merged.out : range.head;
    const candidates = (await git(root, ["diff", "--no-renames", "--name-only", sha, tip])).out.split("\n").filter(Boolean).filter(file => inRange.has(file) && !exempt.has(file) && !allEvidence.has(file));
    // Several tranches may land in one change (a merge-queue batch): a file another changed ready record approved
    // with exactly this content is that tranche's, not drift.
    const drift: string[] = [];
    for (const file of candidates) {
      let covered = false;
      for (const other of siblings) if (other !== sha && !(await git(root, ["diff", "--quiet", other, tip, "--", `:(top)${file}`])).code) { covered = true; break; }
      if (!covered) drift.push(file);
    }
    if (drift.length) out.push(finding("delivery.merge-gate", path, `${mode === "merge" ? "the branch head" : "this push"} changes ${drift.slice(0, 5).join(", ")}${drift.length > 5 ? ` and ${drift.length - 5} more` : ""} after approved_sha ${sha.slice(0, 7)}; any change after approval needs a fresh review`));
  }
  return out;
}
