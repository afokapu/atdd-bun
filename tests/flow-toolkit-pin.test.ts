// URN: test:toolkit:flow-toolkit-pin:E001-UNIT-001-bound-test-file
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FLOW_VERSION = "0.3.82";
const root = join(import.meta.dir, "..");

test("package.json pins @afokapu/atdd-flow to the exact authorized version", async () => {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  expect(manifest.dependencies["@afokapu/atdd-flow"]).toBe(FLOW_VERSION);
});

test("bun.lock workspace entry and resolution agree with the exact atdd-flow pin", async () => {
  const lock = await readFile(join(root, "bun.lock"), "utf8");
  expect(lock).toContain(`"@afokapu/atdd-flow": "${FLOW_VERSION}"`);
  expect(lock).toContain(`"@afokapu/atdd-flow": ["@afokapu/atdd-flow@${FLOW_VERSION}"`);
});
