#!/usr/bin/env bun
// Member check: coder.bun.telemetry-vendor-sdk  (telemetry code family)
//
// CONTRACT (v1.1): reads ATDD_SCAN_ROOTS / ATDD_SCAN_EXCLUDES, writes RAW violations
// to ATDD_VIOLATIONS_REPORT, exits 0 regardless of count.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT } from "../../../lib/scan.mjs";
import { allImportSpecifiers, layerOf } from "../../../lib/imports.mjs";
import { registry } from "../registry.mjs";

// Core depends only on a neutral TelemetryPort. Vendor SDKs and exporters belong in
// the outer infrastructure adapters: the integration layer, or an infrastructure/
// directory. A layered file that is neither has no business importing a vendor SDK —
// type-only imports included, because the coupling is real even when erased.
const RULE = "coder.bun.telemetry-vendor-sdk";
const VENDOR_SDK = /^(?:@opentelemetry\/|@sentry\/|@datadog\/|@posthog\/|@statsig\/|@braze\/|@heap\/|@rudderstack\/|@segment\/|@amplitude\/|@mixpanel\/|dd-trace$|newrelic$|segment$|mixpanel$|amplitude$)/;
const INFRASTRUCTURE = /[/\\]infrastructure[/\\]/;

const { adopted } = await registry();
const violations = [];
if (adopted) {
  const excludes = readExcludes();
  for (const root of readRoots()) {
    for (const file of walk(root, excludes, SOURCE_EXT)) {
      const layer = layerOf(file);
      if (!layer || layer === "integration" || INFRASTRUCTURE.test(file)) continue;
      const text = readText(file);
      if (!text) continue;
      for (const specifier of allImportSpecifiers(text)) {
        if (!VENDOR_SDK.test(specifier)) continue;
        const at = text.indexOf(specifier);
        violations.push({ rule_id: RULE, file, ...locate(text, at === -1 ? 0 : at),
          evidence: `${layer} layer imports telemetry vendor SDK '${specifier}'; core depends only on the TelemetryPort — wire exporters in infrastructure adapters (integration layer)` });
      }
    }
  }
}
process.stderr.write(`bun-telemetry[vendor-sdk]: ${violations.length} violation(s)\n`);
emit(violations);
