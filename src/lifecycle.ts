import { loadPlan, type PlanArtifact } from "./planner-kernel";

/**
 * STAGED ACTIVATION. A brownfield plan can describe far more than is built yet. The unit of activation is
 * the FEATURE (and, for end-to-end coverage, the TRAIN), using the canonical train vocabulary:
 *
 *   planned      declared, not yet executable. Its acceptances are PLANNED DEBT: counted, not enforced.
 *   tested       executable: every acceptance it owns must be bound by a Bun test.
 *   implemented  executable, and implementation evidence (component source) must exist.
 *
 * A feature or train with NO status keeps the pre-lifecycle behaviour (everything executable), so adding
 * this model loosens nothing that was not explicitly declared planned. Structural validation (schemas,
 * planner, topology) never looks at status: a malformed planned artifact still fails.
 *
 * Downgrade rule, stateless so hooks and CI agree without git history: `planned` is allowed only while no
 * component source claims the feature. Once source exists the feature must be tested or implemented, so a
 * move back to planned can never hide implemented behaviour.
 */
export const STATUSES = ["planned", "tested", "implemented"] as const;
export type Status = typeof STATUSES[number];

export type FeatureLifecycle = { urn: string; wagon: string; slug: string; file: string; status?: Status; invalidStatus?: string; wmbts: string[] };
export type TrainLifecycle = { id: string; file: string; status?: Status; invalidStatus?: string };
export type AcceptanceOwnership = { acceptance: string; wmbt: string; file: string; owners: string[] };
export type Lifecycle = {
  /** true once any feature or train declares a status: the repository has opted into staged activation. */
  declared: boolean;
  features: FeatureLifecycle[];
  trains: TrainLifecycle[];
  /** Every declared acceptance, with the features that list its WMBT (or, train-parented, its train). */
  acceptances: AcceptanceOwnership[];
};

const text = (value: unknown) => typeof value === "string" ? value : "";
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const status = (value: unknown): { status?: Status; invalidStatus?: string } => {
  if (value === undefined || value === null) return {};
  return (STATUSES as readonly string[]).includes(String(value)) ? { status: value as Status } : { invalidStatus: String(value) };
};

export function lifecycleOf(artifacts: PlanArtifact[]): Lifecycle {
  const features: FeatureLifecycle[] = artifacts.filter(a => a.kind === "feature").map(a => {
    const [, wagon = "", slug = ""] = a.id.split(":");
    return { urn: a.id, wagon, slug, file: a.file, ...status(a.data.status), wmbts: list(a.data.wmbts).map(w => text(typeof w === "object" && w ? (w as Record<string, unknown>).urn : w)).filter(Boolean) };
  }).sort((x, y) => x.urn.localeCompare(y.urn));
  const trains: TrainLifecycle[] = artifacts.filter(a => a.kind === "train").map(a => ({ id: a.id, file: a.file, ...status(a.data.status) })).sort((x, y) => x.id.localeCompare(y.id));
  const owners = new Map<string, string[]>();
  for (const feature of features) for (const wmbt of feature.wmbts) owners.set(wmbt, [...(owners.get(wmbt) ?? []), feature.urn]);
  // An acceptance belongs to the WMBT that embeds it, or (declared standalone) to the WMBT its URN names:
  // acc:<wagon>:<WMBT code>-<harness>-<NNN>. A train-parented acceptance, acc:train:<subject>:<slug>:<name>,
  // belongs to its train and follows the train's lifecycle.
  const embedding = new Map(artifacts.filter(a => a.kind === "wmbt").map(a => [a.file, a.id]));
  const acceptances: AcceptanceOwnership[] = artifacts.filter(a => a.kind === "acceptance").map(a => {
    const train = a.id.match(/^acc:(train:[^:]+:[^:]+):/), wagon = a.id.match(/^acc:([^:]+):([A-Z][0-9]{3})-/);
    const wmbt = train ? train[1] : embedding.get(a.file) ?? (wagon ? `wmbt:${wagon[1]}:${wagon[2]}` : "");
    return { acceptance: a.id, wmbt, file: a.file, owners: train ? [train[1]] : [...(owners.get(wmbt) ?? [])].sort() };
  }).sort((x, y) => x.acceptance.localeCompare(y.acceptance) || x.file.localeCompare(y.file));
  const declared = features.some(f => f.status || f.invalidStatus) || trains.some(t => t.status || t.invalidStatus);
  return { declared, features, trains, acceptances };
}

export async function loadLifecycle(root = process.cwd()): Promise<Lifecycle> {
  return lifecycleOf((await loadPlan(root)).artifacts);
}

/** An acceptance is planned debt only when exactly one feature (or its train) owns it and that owner is planned. */
export function isPlannedAcceptance(lifecycle: Lifecycle, acceptance: string): boolean {
  const ownership = lifecycle.acceptances.find(a => a.acceptance === acceptance);
  if (!ownership || ownership.owners.length !== 1) return false;
  const owner = ownership.owners[0];
  return (owner.startsWith("train:") ? lifecycle.trains.find(t => t.id === owner) : lifecycle.features.find(f => f.urn === owner))?.status === "planned";
}

/** A train needs end-to-end coverage unless it explicitly declares `status: planned`. */
export function isPlannedTrain(lifecycle: Lifecycle, train: string): boolean {
  return lifecycle.trains.find(t => t.id === train)?.status === "planned";
}

/** undeclared: no status (executable, as before lifecycles); invalid: a status outside the vocabulary. */
type Bucket = Status | "undeclared" | "invalid";
const BUCKETS: Bucket[] = ["planned", "tested", "implemented", "undeclared", "invalid"];

export type PlannedDebt = {
  features: Record<Bucket, number>;
  trains: Record<Bucket, number>;
  plannedAcceptances: Array<{ acceptance: string; owner: string }>;
  plannedTrains: string[];
};

/** The deterministic planned-debt report: sorted, no timestamps, identical for identical plans. */
export function plannedDebt(lifecycle: Lifecycle): PlannedDebt {
  const count = (items: Array<{ status?: Status; invalidStatus?: string }>) => Object.fromEntries(BUCKETS.map(bucket => [bucket, items.filter(i => (i.status ?? (i.invalidStatus !== undefined ? "invalid" : "undeclared")) === bucket).length])) as Record<Bucket, number>;
  return {
    features: count(lifecycle.features),
    trains: count(lifecycle.trains),
    plannedAcceptances: lifecycle.acceptances.filter(a => isPlannedAcceptance(lifecycle, a.acceptance)).map(a => ({ acceptance: a.acceptance, owner: a.owners[0] })),
    plannedTrains: lifecycle.trains.filter(t => t.status === "planned").map(t => t.id),
  };
}

/** Plain-text form of the planned-debt report, stable line for line. */
export function formatPlannedDebt(debt: PlannedDebt): string {
  const counts = (record: Record<string, number>) => BUCKETS.map(k => `${k} ${record[k]}`).join(", ");
  return [
    `features: ${counts(debt.features)}`,
    `trains: ${counts(debt.trains)}`,
    `planned acceptances: ${debt.plannedAcceptances.length}`,
    ...debt.plannedAcceptances.map(a => `  ${a.acceptance} (${a.owner})`),
    `planned trains: ${debt.plannedTrains.length}`,
    ...debt.plannedTrains.map(t => `  ${t}`),
  ].join("\n");
}
