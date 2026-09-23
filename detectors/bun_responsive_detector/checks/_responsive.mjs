// Shared scaffolding for the bun_responsive_detector family: every UI file under the scan roots.
import { resolve } from "node:path";
import { walk, readRoots, readExcludes, readText, emit, locate } from "../../../lib/scan.mjs";
export { frontendConfig } from "../../../lib/frontend.mjs";
export { declarations } from "../../bun_design_system_detector/checks/_design.mjs";

const UI = new Set([".html", ".htm", ".css", ".tsx", ".jsx"]);

/** Run a check over each scan root: `judge(root, files, report)` where files are { file, text }. */
export function runCheck(tag, judge) {
  const violations = [];
  for (const root of readRoots()) {
    const files = [];
    for (const file of walk(root, readExcludes(), UI)) { const text = readText(file); if (text !== null) files.push({ file, text }); }
    judge(resolve(root), files, (rule_id, file, text, index, evidence) => violations.push({ rule_id, file, ...locate(text, index), evidence }));
  }
  process.stderr.write(`bun-detector[${tag}]: ${violations.length} violation(s)\n`);
  emit(violations);
}
