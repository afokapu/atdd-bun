// URN: test:billing:invoice:E001-UNIT-002-numbers-invoice
// Acceptance: acc:billing:E001-UNIT-002-numbers-invoice
import { expect, it } from "bun:test";
import { invoice } from "../../../../../../src/wagons/billing/features/invoice/domain/invoice";

it("numbers an invoice by its total", () => expect(invoice(3)).toBe("invoice:3"));
