import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { validateDelivery } from "../../src/delivery.ts";

const roots = JSON.parse(process.env.ATDD_SCAN_ROOTS ?? "[]"), report = process.env.ATDD_VIOLATIONS_REPORT;
if (!report) throw new Error("ATDD_VIOLATIONS_REPORT is required");
const violations = (await Promise.all(roots.map(root => validateDelivery(root)))).flat().map(item => ({ ...item, line: 1, col: 1, source_line: "" }));
await mkdir(dirname(report), { recursive: true });
await writeFile(report, JSON.stringify({ violations }, null, 2));
