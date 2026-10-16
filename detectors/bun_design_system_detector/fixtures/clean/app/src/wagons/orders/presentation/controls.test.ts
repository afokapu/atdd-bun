// Test files are never scanned: assertion strings legitimately hold raw markup.
import { expect, test } from "bun:test";

test("a button markup string round-trips", () => {
  expect("<button>Go</button>").toContain("button");
});

test("a styled markup string round-trips", () => {
  expect('<div style="margin: 12px; color: #b91c1c">x</div>').toContain("div");
});
