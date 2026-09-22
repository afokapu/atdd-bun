#!/usr/bin/env bun
// Detector: coder.bun.runtime-single-lockfile  (disposition: strict)
//
// Bun is this stack's package manager, so `bun.lock` (or `bun.lockb`) is the ONE
// resolution source of truth. A `package-lock.json`, `yarn.lock` or
// `pnpm-lock.yaml` left beside it means two resolvers disagree about the
// dependency graph, and which one wins is decided by whichever command a
// developer or a CI step happens to run. That is the exact shape of the
// "works locally, breaks in CI" dependency drift, and it is invisible in review
// because nobody reads a lockfile diff.
//
// A repo-hygiene rule: the FILE is the fact, so it reports at line 1 of the
// offending lockfile.
import { walkByName, readRoots, readExcludes, emit } from "../../../lib/scan.mjs";

const RULE_ID = "coder.bun.runtime-single-lockfile";
const FOREIGN_LOCKFILES = new Map([
  ["package-lock.json", "npm"],
  ["yarn.lock", "Yarn"],
  ["pnpm-lock.yaml", "pnpm"],
  ["pnpm-lock.yml", "pnpm"],
]);

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walkByName(root, excludes, new Set(FOREIGN_LOCKFILES.keys()))) {
    const name = file.split("/").pop();
    violations.push({
      rule_id: RULE_ID,
      file,
      line: 1,
      col: 1,
      source_line: name,
      evidence: `${FOREIGN_LOCKFILES.get(name)} lockfile ${name} coexists with Bun's; two resolvers disagree and the winner depends on which command runs`,
    });
  }
}
process.stderr.write(`bun-detector[single-lockfile]: ${violations.length} violation(s)\n`);
emit(violations);
