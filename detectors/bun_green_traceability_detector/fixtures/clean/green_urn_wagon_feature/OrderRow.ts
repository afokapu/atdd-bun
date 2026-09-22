#!/usr/bin/env bun
// URN: component:orders:checkout:OrderRow:backend:presentation
// Tested-By:
// - test:orders:checkout:E001-SMOKE-001-renders-row
// Runtime: bun
// Purpose: render one order row fragment for htmx to swap
export const OrderRow = (o) => `<li>${escapeHtml(o.title)}</li>`;
