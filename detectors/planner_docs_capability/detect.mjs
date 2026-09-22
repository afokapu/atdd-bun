import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { scanDocumentation } from "../../src/docs-capability.ts";

const roots = JSON.parse(process.env.ATDD_SCAN_ROOTS ?? "[]");
const report = process.env.ATDD_VIOLATIONS_REPORT;
const violations = (await Promise.all(roots.map(scanDocumentation))).flat();
if (!report) throw new Error("ATDD_VIOLATIONS_REPORT is required");
await mkdir(dirname(report), { recursive: true });
await writeFile(report, JSON.stringify({ violations }, null, 2));
