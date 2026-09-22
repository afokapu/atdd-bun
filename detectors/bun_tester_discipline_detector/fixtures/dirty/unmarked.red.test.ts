// URN: test:orders:checkout:E024-RED-001
// Acceptance: acc:orders:E024-RED-001
// Phase: RED
// Layer: domain
import { it, expect } from "bun:test";
import { total } from "../src/total";
it("refuses a zero total", () => { expect(() => total([])).toThrow("EMPTY_CART"); });
