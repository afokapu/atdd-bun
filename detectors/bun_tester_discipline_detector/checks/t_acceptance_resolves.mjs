#!/usr/bin/env bun
// Member check: tester.bun.acceptance-resolves-to-declared  (tester discipline family)
//
// A test's `// Acceptance:` / `// WMBT:` header must name something the PLAN actually
// declares. Its sibling t_acceptance_binding only asks whether a header is PRESENT,
// which a test satisfies by naming anything at all: a suite bound to
// `acc:does-not-exist:E999-NEVER-DECLARED` passed every gated rule in this workspace.
// That is the recurring defect in this hub — a NAME accepted where a CLAIM is required.
//
// Core owns the SHAPE of these artifacts (wmbt.schema.json, acceptance.schema.json) and
// validates them where they live. It cannot know whether a Bun test file resolves into
// them, because finding the reference means reading Bun test headers. The shape is
// core's; the binding is this extension's. That division is why the rule lives here.
//
// NOT_APPLICABLE, not FAIL, when the consumer declares no acceptances at all: a repo
// with no plan/ has nothing to resolve against, and reporting there would fire on every
// unplanned project rather than on a broken reference.
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW
// {rule_id,file,line,col,evidence,source_line} to ATDD_VIOLATIONS_REPORT, exits 0.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_EXCLUDES, parseJsonEnv, walkTests, parseHeader } from "../test_header.mjs";

const RULE = "tester.bun.acceptance-resolves-to-declared";

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

function planFiles(dir, excludes) {
  const out = [];
  (function rec(d) {
    let entries;
    try { entries = readdirSync(d).sort(); } catch { return; }
    for (const name of entries) {
      if (excludes.includes(name)) continue;
      const full = join(d, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) rec(full);
      else if (/\.ya?ml$/.test(name)) out.push(full);
    }
  })(dir);
  return out;
}

// Every acceptance / WMBT URN the plan declares. Read as TOKENS rather than parsed
// structurally on purpose: acceptances live under several keys across wagon, feature
// and WMBT documents, and a reference is resolvable if the plan states that URN
// anywhere. Over-accepting here is safe — the failure this rule exists to catch is a
// reference to something the plan never mentions at all.
function declaredUrns(croot, excludes) {
  const urns = new Set();
  for (const f of planFiles(join(croot, "plan"), excludes)) {
    for (const m of read(f).matchAll(/\b((?:acc|wmbt):[a-z0-9][\w.-]*(?::[\w.-]+)?)/gi)) {
      urns.add(m[1]);
    }
  }
  return urns;
}

function consumerRoots(root, excludes) {
  const roots = [];
  (function rec(d) {
    let st;
    try { st = statSync(d); } catch { return; }
    if (!st.isDirectory()) return;
    try { if (statSync(join(d, "plan")).isDirectory()) { roots.push(d); return; } } catch {}
    let entries;
    try { entries = readdirSync(d).sort(); } catch { return; }
    for (const n of entries) if (!excludes.includes(n)) rec(join(d, n));
  })(root);
  return roots;
}

const reportPath = process.env.ATDD_VIOLATIONS_REPORT;
if (!reportPath) {
  process.stderr.write("tester-check: ATDD_VIOLATIONS_REPORT not set\n");
  process.exit(2);
}
const excludes = [...DEFAULT_EXCLUDES, ...parseJsonEnv("ATDD_SCAN_EXCLUDES", [])];
const violations = [];

for (const root of parseJsonEnv("ATDD_SCAN_ROOTS", [])) {
  for (const croot of consumerRoots(root, excludes)) {
    const declared = declaredUrns(croot, excludes);
    if (!declared.size) continue;          // nothing declared: nothing to resolve against
    for (const file of walkTests(croot, excludes)) {
      const H = parseHeader(read(file));
      for (const [label, field] of [["Acceptance", "acceptance"], ["WMBT", "wmbt"]]) {
        const ref = H[field];
        if (!ref || !ref.value) continue;
        if (declared.has(ref.value)) continue;
        violations.push({
          rule_id: RULE, file, line: ref.no, col: 1,
          evidence:
            `\`// ${label}: ${ref.value}\` names nothing the plan declares; the test is bound ` +
            `to an artifact that does not exist, so the coverage gate attributes it to nothing`,
          source_line: ref.raw ?? "",
        });
      }
    }
  }
}
writeFileSync(reportPath, JSON.stringify({ violations }, null, 2), "utf8");
process.stderr.write(`bun-tester[acceptance-resolves]: ${violations.length} violation(s)\n`);
process.exit(0);
