import { expect, test } from "bun:test";

// URN: test:checkout:cart:E001-UNIT-001

test("parses a journey test URN", () => {
  expect("test:train:orders:place-order:E2E-001-a".split(":").length).toBe(6);
});
