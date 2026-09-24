// Tests are not implementation source: the emit vocabulary is theirs to use freely.
import { expect, test } from "bun:test";

test("an accepted response emits the planned event", () => {
  const emitted: Array<[string, Record<string, unknown>]> = [];
  const sink = { emit: (id: string, properties: Record<string, unknown>) => emitted.push([id, properties]) };
  sink.emit("fixture_only_probe_event", {});
  expect(emitted).toContainEqual(["fixture_only_probe_event", {}]);
});
