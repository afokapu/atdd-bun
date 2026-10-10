// Phase: SMOKE
import { expect, test } from "bun:test";
import { dispatch } from "../../server";

test("resolve_match traverses the exported journey dispatch", () => {
  const result = dispatch("resolve_match", { voted: true }, { requestId: "r1" });
  expect(result.selectedTrainId).toBe("train:match:nominal");
});
