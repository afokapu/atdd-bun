// URN: component:orders:place:Total:backend:domain
// Tested-By:
// - test:orders:place:E001-UNIT-001-totals-the-cart
// Runtime: bun
// Purpose: sum the prices of an order's lines
export const total = (lines: { price: number }[]): number => lines.reduce((sum, line) => sum + line.price, 0);
