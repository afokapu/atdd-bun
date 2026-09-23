import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { validatePlan } from "../../src/planner-kernel.ts";

const roots = JSON.parse(process.env.ATDD_SCAN_ROOTS ?? "[]"), report = process.env.ATDD_VIOLATIONS_REPORT;
if (!report) throw new Error("ATDD_VIOLATIONS_REPORT is required");
const ids = {
  "planner.kernel.parse": "atdd-bun.planner.parse",
  "planner.kernel.identity-required": "atdd-bun.planner.identity-required",
  "planner.kernel.identity-unique": "atdd-bun.planner.identity-unique",
  "planner.kernel.reference-resolves": "atdd-bun.planner.reference-resolves",
  "planner.kernel.train-wagon-resolves": "atdd-bun.planner.train-wagon-resolves",
  "planner.kernel.interlocking-participant-resolves": "atdd-bun.planner.interlocking-participant-resolves",
  "planner.kernel.acceptance-well-formed": "atdd-bun.planner.acceptance-identity",
};
const violations = (await Promise.all(roots.map(validatePlan))).flatMap(graph => graph.findings).map(item => ({
  ...item,
  // Every kernel finding reports under a declared package rule. An unmapped one is a new emission path:
  // fail loudly rather than publish a rule id nothing declares (tests/rule-coverage.test.ts maps them all).
  rule_id: ids[item.rule_id] ?? (() => { throw new Error(`planner_plan_integrity: kernel rule ${item.rule_id} has no declared package rule; map it in detect.mjs`); })(),
  line: 1,
  col: 1,
  source_line: "",
}));
await mkdir(dirname(report), { recursive: true });
await writeFile(report, JSON.stringify({ violations }, null, 2));
