import { expect, test } from "bun:test";
import { enforce, type EnforcementConfig } from "./enforce";

export function registerEnforcementTest(config: EnforcementConfig = {}): void {
  test("ATDD Bun enforcement", async () => {
    expect(await enforce(config)).toEqual([]);
  });
}
