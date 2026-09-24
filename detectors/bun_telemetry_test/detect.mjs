#!/usr/bin/env bun
// FAMILY validator: bun_telemetry_test
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
let crashed = false;
for (const c of checks) {
  const rep = join(td, c + ".json");
  let exitedCleanly = true;
  try {
    execFileSync(process.execPath, [join(here, "checks", c)], {
      env: { ...process.env, ATDD_VIOLATIONS_REPORT: rep },
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch {
    exitedCleanly = false; /* a member may exit non-zero after writing its report */
  }
  let read = false;
  try {
    out.push(...JSON.parse(readFileSync(rep, "utf8")).violations);
    read = true;
  } catch {}
  // A member that crashed WITHOUT a report is a detector bug, and swallowing it here is a silent
  // pass — the exact failure that once hid a broken regex behind zero findings. Fail loudly.
  if (!exitedCleanly && !read) {
    process.stderr.write(`family bun_telemetry_test: member ${c} crashed without a violation report\n`);
    crashed = true;
  }
}
if (crashed) process.exit(2); // a crashed member is a detector bug: fail loudly, not silently
writeFileSync(reportPath, JSON.stringify({ violations: out }, null, 2), "utf8");
process.stderr.write("family bun_telemetry_test: " + out.length + " violation(s)\n");
process.exit(0);
