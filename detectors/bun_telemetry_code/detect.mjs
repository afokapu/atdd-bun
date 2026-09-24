#!/usr/bin/env bun
// FAMILY validator: bun_telemetry_code
// Runs each member check (checks/*.mjs) VERBATIM as a subprocess and merges their
// RAW v1.1 reports into one — one implementation realizing a family of rule_ids.
// Files whose name begins with `_` are skipped: they are shared helpers.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = process.env.ATDD_VIOLATIONS_REPORT;
if (!reportPath) {
  process.stderr.write("family: ATDD_VIOLATIONS_REPORT is not set\n");
  process.exit(2);
}
const checks = readdirSync(join(here, "checks"))
  .filter((f) => (f.endsWith(".mjs") || f.endsWith(".ts")) && !f.startsWith("_"))
  .sort();
const td = mkdtempSync(join(tmpdir(), "atdd-bun-fam-"));
const out = [];
for (const c of checks) {
  const rep = join(td, c + ".json");
  try {
    execFileSync(process.execPath, [join(here, "checks", c)], {
      env: { ...process.env, ATDD_VIOLATIONS_REPORT: rep },
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch {
    /* a member may exit non-zero; still try to read its report */
  }
  try {
    out.push(...JSON.parse(readFileSync(rep, "utf8")).violations);
  } catch {}
}
writeFileSync(reportPath, JSON.stringify({ violations: out }, null, 2), "utf8");
process.stderr.write("family bun_telemetry_code: " + out.length + " violation(s)\n");
process.exit(0);
