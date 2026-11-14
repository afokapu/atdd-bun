// URN: component:toolkit:owner-inspection-evidence:OwnerInspectionEvidence:backend:application
// Tested-By:
//   - test:toolkit:owner-inspection-evidence:E001-UNIT-001-bound-test-file
// Runtime: bun
// Purpose: Read-only check of a Flow owner-inspection/v1 record against the candidate
import { createHash } from "node:crypto";
import type { OwnerInspectionRecord } from "@afokapu/atdd-flow/src/owner-inspection";

/**
 * Read-only consumer of the Flow-owned owner-inspection/v1 record. The record shape, publication, acknowledgement and
 * lifecycle belong to Flow; this module only reports whether a record Flow already read is acceptable evidence for the
 * candidate. It writes nothing, spawns nothing, and never leaves the process.
 */
const RULE_PREFIX = "atdd-bun.review.owner-inspectability";
export const OWNER_INSPECTION_RULE_IDS = [
  `${RULE_PREFIX}.stale-candidate`, `${RULE_PREFIX}.evidence-digest-mismatch`, `${RULE_PREFIX}.non-local-target`,
  `${RULE_PREFIX}.non-synthetic-data`, `${RULE_PREFIX}.missing-teardown`, `${RULE_PREFIX}.invalid-not-applicable`,
  `${RULE_PREFIX}.unacknowledged`,
] as const;
export type OwnerInspectionRuleId = typeof OWNER_INSPECTION_RULE_IDS[number];
export type OwnerInspectionFinding = { rule_id: OwnerInspectionRuleId; where: string; message: string };
export type OwnerInspectionCheck = { verdict: "PASS" | "FAIL" | "COULD_NOT_CHECK"; findings: OwnerInspectionFinding[] };
export type OwnerInspectionCandidate = { sha: string; readTracked: (path: string) => Promise<Uint8Array | undefined> };
export type OwnerInspectionInput = { record: OwnerInspectionRecord; candidate: OwnerInspectionCandidate; mode?: "candidate" | "done" };

type Reference = { kind?: unknown; locator?: unknown; sha256?: unknown };
const DIRECTIVE = "owner directive M-20261011T121147Z";
const NA_EVIDENCE_KINDS = ["ci", "ratchet", "package"];
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost"];

const rule = (name: string) => `${RULE_PREFIX}.${name}` as OwnerInspectionRuleId;
const found = (name: string, where: string, message: string): OwnerInspectionFinding => ({ rule_id: rule(name), where, message });
const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const trackedPath = (locator: string) => !/^[a-z][a-z0-9+.-]*:/i.test(locator) && !locator.startsWith("/") && !locator.split("/").includes("..");

function staleCandidate(input: OwnerInspectionInput): OwnerInspectionFinding[] {
  const { record, candidate } = input;
  const findings: OwnerInspectionFinding[] = [];
  if (record.provenance?.commit !== candidate.sha) findings.push(found("stale-candidate", "provenance.commit", `the record was published for ${String(record.provenance?.commit)}, not the candidate ${candidate.sha}`));
  if (record.stage === "merge" && !text(record.candidate)) findings.push(found("stale-candidate", "candidate", "a merge record must cite the published candidate record it follows"));
  return findings;
}

function targetFindings(record: OwnerInspectionRecord): OwnerInspectionFinding[] {
  const target = record.target;
  if (target?.kind !== "local") return [found("non-local-target", "target.kind", `a ${String(target?.kind)} target is not authorized by this convention; only a loopback local target is, absent ${DIRECTIVE}`)];
  try {
    const url = new URL(String(target.locator));
    const loopback = LOOPBACK_HOSTS.includes(url.hostname) && !url.username && !url.password;
    return loopback ? [] : [found("non-local-target", "target.locator", "a local target must be a credential-free 127.0.0.1 or localhost URL")];
  } catch {
    return [found("non-local-target", "target.locator", "a local target must be a credential-free 127.0.0.1 or localhost URL")];
  }
}

function notApplicableFindings(record: OwnerInspectionRecord): OwnerInspectionFinding[] {
  const rendered = record.evidence.rendered as { na?: boolean; rationale?: unknown; evidence?: Reference };
  if (rendered?.na !== true) return [];
  const problems = [
    record.surface.kind === "toolkit" ? "" : "N/A is allowed only for a toolkit surface",
    text(rendered.rationale) ? "" : "N/A needs an exact rationale",
    NA_EVIDENCE_KINDS.includes(String(rendered.evidence?.kind)) ? "" : "N/A needs direct ci, ratchet, or package evidence",
  ].filter(Boolean);
  return problems.map((problem) => found("invalid-not-applicable", "evidence.rendered", problem));
}

const hasDigest = (reference: Reference | undefined) => text(reference?.locator) && /^[a-f0-9]{64}$/.test(String(reference?.sha256));

type Evidence = { where: string; reference: Reference | undefined };
function evidenceList(record: OwnerInspectionRecord): Evidence[] {
  const { health, smoke, teardown, rendered } = record.evidence as Record<string, Reference & { na?: boolean; evidence?: Reference }>;
  const renderedReference = rendered?.na === true ? rendered.evidence : rendered;
  return [{ where: "evidence.health", reference: health }, { where: "evidence.smoke", reference: smoke }, { where: "evidence.teardown", reference: teardown }, { where: "evidence.rendered", reference: renderedReference }];
}

type Verified = { findings: OwnerInspectionFinding[]; unverified: boolean };
async function verifyEvidence(item: Evidence, candidate: OwnerInspectionCandidate): Promise<Verified> {
  if (!hasDigest(item.reference)) {
    const name = item.where === "evidence.teardown" ? "missing-teardown" : "evidence-digest-mismatch";
    return { findings: [found(name, item.where, `${item.where} needs a locator and a sha256 digest`)], unverified: false };
  }
  const locator = String(item.reference?.locator);
  const bytes = trackedPath(locator) ? await candidate.readTracked(locator) : undefined;
  if (!bytes) return { findings: [], unverified: true };
  const actual = createHash("sha256").update(bytes).digest("hex");
  return actual === item.reference?.sha256 ? { findings: [], unverified: false } : { findings: [found("evidence-digest-mismatch", item.where, `${locator} no longer matches the recorded digest`)], unverified: false };
}

function acknowledgementFindings(input: OwnerInspectionInput): OwnerInspectionFinding[] {
  if (input.mode !== "done") return [];
  const acknowledged = (input.record.acknowledgements ?? []).some((entry) => entry.by === "operator@desk");
  return acknowledged ? [] : [found("unacknowledged", "acknowledgements", "operator@desk has not acknowledged this inspection")];
}

/** Checks a Flow-read owner-inspection record against the candidate; FAIL on any finding, COULD_NOT_CHECK when evidence cannot be read from tracked files. */
export async function checkOwnerInspection(input: OwnerInspectionInput): Promise<OwnerInspectionCheck> {
  const { record, candidate } = input;
  const verified = await Promise.all(evidenceList(record).map((item) => verifyEvidence(item, candidate)));
  const findings = [
    ...staleCandidate(input), ...targetFindings(record), ...notApplicableFindings(record), ...acknowledgementFindings(input), ...verified.flatMap((entry) => entry.findings),
    ...(record.data_classification === "synthetic" ? [] : [found("non-synthetic-data", "data_classification", "Bun applicability policy requires data_classification to be exactly synthetic")]),
  ];
  if (findings.length) return { verdict: "FAIL", findings };
  return { verdict: verified.some((entry) => entry.unverified) ? "COULD_NOT_CHECK" : "PASS", findings };
}
