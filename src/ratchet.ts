/** Pure v1 primitives for the opt-in exact-base finding ratchet. No baseline is written or accepted. */
export type RatchetMode = "report" | "reject-new";
export type RatchetPolicy = { mode: RatchetMode; profiles: string[] };
export type FindingIdentity = {
  rule_id: string;
  file: string;
  subject?: string;
  line?: number;
  col?: number;
  evidence?: string;
  source_line?: string;
};

const canonical = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  throw new Error(`cannot canonicalize ${typeof value}`);
};
const sha256 = (value: unknown) => new Bun.CryptoHasher("sha256").update(canonical(value)).digest("hex");
const normalizedPath = (path: string) => {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) throw new Error(`ratchet finding path must be normalized and repository-relative: ${path}`);
  return normalized;
};

/** Stable semantic identity: presentation position and rendered evidence deliberately do not participate. */
export function findingFingerprint(finding: FindingIdentity): string {
  const path = normalizedPath(finding.file), subject = finding.subject ?? path;
  if (!finding.rule_id || !subject) throw new Error("ratchet finding requires rule_id and semantic subject");
  return sha256({ format: "atdd-bun.finding-fingerprint/v1", rule_id: finding.rule_id, path, subject });
}

/** The selected profiles and every policy key except ratchet itself must agree across exact base and candidate. */
export function contextDigest(config: Record<string, unknown>, profiles: string[]): string {
  const { ratchet: _ratchet, ...policy } = config;
  return sha256({ format: "atdd-bun.ratchet-context/v1", profiles: [...profiles].sort(), policy });
}

/** Activation is a one-time, explicitly requested profile-list expansion; every other policy input remains identical. */
export function activationContextDigest(config: Record<string, unknown>): string {
  const { ratchet: _ratchet, profiles: _profiles, ...policy } = config;
  return sha256({ format: "atdd-bun.ratchet-activation-context/v1", policy });
}

export function isStrictProfileExpansion(base: string[], candidate: string[]): boolean {
  const before = new Set(base), after = new Set(candidate);
  return before.size < after.size && [...before].every(profile => after.has(profile));
}

export function parseRatchetPolicy(config: Record<string, unknown>): RatchetPolicy | null {
  if (config.ratchet === undefined) return null;
  const value = config.ratchet;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("atdd-bun.yaml ratchet must be a mapping");
  const mode = (value as Record<string, unknown>).mode, profiles = (value as Record<string, unknown>).profiles;
  if (mode !== "report" && mode !== "reject-new") throw new Error("atdd-bun.yaml ratchet.mode must be report or reject-new");
  if (!Array.isArray(profiles) || !profiles.length || !profiles.every(profile => typeof profile === "string")) throw new Error("atdd-bun.yaml ratchet.profiles must be a non-empty list of profile names");
  return { mode, profiles: [...new Set(profiles)].sort() };
}

export function compareFindings(base: FindingIdentity[], candidate: FindingIdentity[]) {
  const baseSet = new Set(base.map(findingFingerprint)), candidateSet = new Set(candidate.map(findingFingerprint));
  const list = (source: Set<string>, absent: Set<string>) => [...source].filter(item => !absent.has(item)).sort();
  return { carried: [...baseSet].filter(item => candidateSet.has(item)).sort(), new: list(candidateSet, baseSet), resolved: list(baseSet, candidateSet) };
}
