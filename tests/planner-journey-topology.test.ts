import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateStaticPlannerConventions } from "../src/planner-validators";

async function write(root: string, path: string, content: string) {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

const train = (id: string, artifact: string) => `train_id: ${id}
sequence:
  - step: 1
    intent: produce handoff
    from: system:test
    to: system:test
    artifact: ${artifact}
`;

const interlocking = (id: string, route: string, trainId: string) => `interlocking_id: ${id}
routes:
  - route_id: ${route}
    train_id: ${trainId}
`;

test("journey topology closes every reachable interlocking route", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-bun-journey-"));
  try {
    await write(root, "plan/_trains/a.yaml", train("train:test:a", "test:a-complete"));
    await write(root, "plan/_trains/b.yaml", train("train:test:b", "test:b-complete"));
    await write(root, "plan/_trains/_interlockings/a.yaml", interlocking("interlocking:a", "go", "train:test:a"));
    await write(root, "plan/_trains/_interlockings/b.yaml", interlocking("interlocking:b", "done", "train:test:b"));
    await write(root, "plan/_journeys/example.yaml", `schema_version: 1.0.0
journey_id: journey:example
title: Example journey
status: checked
entrypoint:
  interlocking_id: interlocking:a
  exposed: false
  actions: []
  reason: internal-transition-only
  surfaces: [backend]
continuations:
  - from:
      interlocking_id: interlocking:a
      route_id: go
    artifact: test:a-complete
    to:
      interlocking_id: interlocking:b
terminals:
  - from:
      interlocking_id: interlocking:b
      route_id: done
    outcome: completed
`);

    const findings = (await validateStaticPlannerConventions(root)).filter(item => item.rule_id === "planner.journey.continuation-closure");
    expect(findings).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("journey topology rejects duplicate, unbound, and disconnected handoffs", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-bun-journey-"));
  try {
    await write(root, "plan/_trains/a.yaml", train("train:test:a", "test:a-complete"));
    await write(root, "plan/_trains/b.yaml", train("train:test:b", "test:b-complete"));
    await write(root, "plan/_trains/c.yaml", train("train:test:c", "test:c-complete"));
    await write(root, "plan/_trains/_interlockings/a.yaml", interlocking("interlocking:a", "go", "train:test:a"));
    await write(root, "plan/_trains/_interlockings/b.yaml", interlocking("interlocking:b", "done", "train:test:b"));
    await write(root, "plan/_trains/_interlockings/c.yaml", interlocking("interlocking:c", "orphan", "train:test:c"));
    await write(root, "plan/_journeys/broken.yaml", `schema_version: 1.0.0
journey_id: journey:broken
title: Broken journey
status: checked
entrypoint:
  interlocking_id: interlocking:a
  exposed: false
  actions: []
  reason: internal-transition-only
  surfaces: [backend]
continuations:
  - from:
      interlocking_id: interlocking:a
      route_id: go
    artifact: test:not-produced
    to:
      interlocking_id: interlocking:b
terminals:
  - from:
      interlocking_id: interlocking:a
      route_id: go
    outcome: duplicate exit
  - from:
      interlocking_id: interlocking:b
      route_id: missing
    outcome: nonexistent route
  - from:
      interlocking_id: interlocking:c
      route_id: orphan
    outcome: disconnected
`);

    const evidence = (await validateStaticPlannerConventions(root))
      .filter(item => item.rule_id === "planner.journey.continuation-closure")
      .map(item => item.evidence);

    expect(evidence.some(item => item.includes("waits for test:not-produced"))).toBe(true);
    expect(evidence.some(item => item.includes("interlocking:b#missing"))).toBe(true);
    expect(evidence.some(item => item.includes("interlocking:a#go must have exactly one") && item.includes("found 2"))).toBe(true);
    expect(evidence.some(item => item.includes("interlocking:b#done must have exactly one") && item.includes("found 0"))).toBe(true);
    expect(evidence.some(item => item.includes("unreachable interlocking:c#orphan"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("journey topology rejects implicit continuation cycles", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-bun-journey-"));
  try {
    await write(root, "plan/_trains/a.yaml", train("train:test:a", "test:a-complete"));
    await write(root, "plan/_trains/b.yaml", train("train:test:b", "test:b-complete"));
    await write(root, "plan/_trains/_interlockings/a.yaml", interlocking("interlocking:a", "go", "train:test:a"));
    await write(root, "plan/_trains/_interlockings/b.yaml", interlocking("interlocking:b", "back", "train:test:b"));
    await write(root, "plan/_journeys/cycle.yaml", `schema_version: 1.0.0
journey_id: journey:cycle
title: Cyclic journey
status: checked
entrypoint:
  interlocking_id: interlocking:a
  exposed: false
  actions: []
  reason: internal-transition-only
  surfaces: [backend]
continuations:
  - from:
      interlocking_id: interlocking:a
      route_id: go
    artifact: test:a-complete
    to:
      interlocking_id: interlocking:b
  - from:
      interlocking_id: interlocking:b
      route_id: back
    artifact: test:b-complete
    to:
      interlocking_id: interlocking:a
terminals: []
`);

    const evidence = (await validateStaticPlannerConventions(root))
      .filter(item => item.rule_id === "planner.journey.continuation-closure")
      .map(item => item.evidence);
    expect(evidence.some(item => item.includes("continuation cycle") && item.includes("interlocking:a") && item.includes("interlocking:b"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("journey topology rejects duplicate route ids in a reachable interlocking", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-bun-journey-"));
  try {
    await write(root, "plan/_trains/a.yaml", train("train:test:a", "test:a-complete"));
    await write(root, "plan/_trains/b.yaml", train("train:test:b", "test:b-complete"));
    await write(root, "plan/_trains/_interlockings/a.yaml", `interlocking_id: interlocking:a
routes:
  - route_id: same
    train_id: train:test:a
  - route_id: same
    train_id: train:test:b
`);
    await write(root, "plan/_journeys/duplicate.yaml", `schema_version: 1.0.0
journey_id: journey:duplicate-route
title: Duplicate route journey
status: checked
entrypoint:
  interlocking_id: interlocking:a
  exposed: false
  actions: []
  reason: internal-transition-only
  surfaces: [backend]
continuations: []
terminals:
  - from:
      interlocking_id: interlocking:a
      route_id: same
    outcome: completed
`);

    const evidence = (await validateStaticPlannerConventions(root))
      .filter(item => item.rule_id === "planner.journey.continuation-closure")
      .map(item => item.evidence);
    expect(evidence.some(item => item.includes("duplicate route_id same"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every interlocking must be composed into a journey, and a plan with none declares at least one", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-bun-composed-"));
  const composed = async () => (await validateStaticPlannerConventions(root)).filter(f => f.rule_id === "planner.journey.interlocking-composed").map(f => f.evidence);
  try {
    for (const name of ["a", "b", "c"]) {
      await write(root, `plan/_trains/${name}.yaml`, train(`train:test:${name}`, `test:${name}-complete`));
      await write(root, `plan/_trains/_interlockings/${name}.yaml`, interlocking(`interlocking:${name}`, "go", `train:test:${name}`));
    }
    const none = await composed();
    expect(none).toHaveLength(3);
    expect(none[0]).toContain("the plan declares 3 interlocking(s) and no journey");

    await write(root, "plan/_journeys/example.yaml", `schema_version: 1.0.0
journey_id: journey:example
title: Example journey
status: checked
entrypoint:
  interlocking_id: interlocking:a
continuations:
  - from: { interlocking_id: interlocking:a, route_id: go }
    artifact: test:a-complete
    to: { interlocking_id: interlocking:b }
terminals:
  - from: { interlocking_id: interlocking:b, route_id: go }
    outcome: completed
`);
    expect(await composed()).toEqual(["interlocking:c is reached by none of the 1 journey(s): no journey enters at it and no reachable continuation leads to it"]);

    await write(root, "plan/_journeys/other.yaml", `schema_version: 1.0.0
journey_id: journey:other
title: Other journey
status: checked
entrypoint:
  interlocking_id: interlocking:c
terminals:
  - from: { interlocking_id: interlocking:c, route_id: go }
    outcome: completed
`);
    expect(await composed()).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
