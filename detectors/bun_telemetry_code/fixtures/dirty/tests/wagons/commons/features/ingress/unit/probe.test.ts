import { expect, test } from "bun:test";

test("a test file may reference undeclared names without tripping the coder rules", () => {
  const sink = { emit: (_id: string) => {} };
  sink.emit("fixture_undeclared_event");
  expect(sink).toBeDefined();
});
