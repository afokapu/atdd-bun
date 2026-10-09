import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { runImplementation } from "../src/enforce";

const root = resolve(import.meta.dir, "fixtures/runner-semantic-integration");
const config = { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] };

test("integrated runner semantics fixture keeps declaration execution, Cargo, journey, Station Master, and production proof connected", async () => {
  for (const detector of ["bun_interlocking_binding", "bun_interlocking_infrastructure", "bun_interlocking_coverage"]) {
    expect(await runImplementation(detector, config)).toEqual([]);
  }
});
