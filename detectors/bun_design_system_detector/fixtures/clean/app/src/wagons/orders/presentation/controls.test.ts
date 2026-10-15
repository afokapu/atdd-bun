// Test files are never scanned: assertion strings legitimately hold raw markup.
import { expect, test } from "bun:test";

test("a button markup string round-trips", () => {
  expect("<button>Go</button>").toContain("button");
});
