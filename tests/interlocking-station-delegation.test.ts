import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImplementation } from "../src/enforce";

test("inert Station Master runner references cannot discharge mapped interlocking delegation", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-station-inert-"));
  try {
    await mkdir(join(root, "src", "trains"), { recursive: true });
    await writeFile(join(root, "server.ts"), `import { InterlockingRunner } from "./src/trains/interlocking";
import { TrainRunner } from "./src/trains/runner";
export const JOURNEY_MAP = { resolve: { interlockingId: "interlocking:proof", path: "plan/_trains/_interlockings/proof.yaml" } };
export function dispatch(_action: string, _inputs: object) { return { selectedTrainId: "train:direct" }; }
`);
    await writeFile(join(root, "src", "trains", "interlocking.ts"), "export class InterlockingRunner {}\n");
    await writeFile(join(root, "src", "trains", "runner.ts"), "export class TrainRunner {}\n");
    const findings = await runImplementation("bun_interlocking_infrastructure", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] });
    expect(findings.map(finding => finding.evidence)).toContain("station-master-dispatch-bypasses-runners: mapped interlocking dispatch must return InterlockingRunner execution; inert runner references or direct business data do not execute the selected train");
  } finally { await rm(root, { recursive: true, force: true }); }
});
