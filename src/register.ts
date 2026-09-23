import { expect, test } from "bun:test";
import { enforce, type EnforcementConfig } from "./enforce";
import { checkIntegrity, formatIntegrity, type IntegrityOptions } from "./integrity";

export function registerEnforcementTest(config: EnforcementConfig = {}): void {
  test("ATDD Bun enforcement", async () => {
    expect(await enforce(config)).toEqual([]);
  });
}

/** A test that fails loudly, with the way back, when protected atdd-bun files were changed. */
export function registerIntegrityTest(options: IntegrityOptions = {}): void {
  test("ATDD integrity: atdd-bun and its generated files are canonical", async () => {
    const findings = await checkIntegrity(options);
    if (findings.length) throw new Error(formatIntegrity(findings));
  });
}
