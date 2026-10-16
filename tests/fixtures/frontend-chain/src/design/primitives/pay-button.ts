// URN: component:checkout:payment:pay-button:frontend:presentation
// Tested-By:
// - test:train:orders:take-payment:E2E-001-takes-payment
// Runtime: bun
// Purpose: chain-fixture design primitive: the pay button app code composes.
// The design system's own primitives render the raw controls: the pay button is
// composed here, self-contained like every other primitive, and app code renders
// it through this module.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const payButton = (label: string) => `<button type="submit" class="button">${escapeHtml(label)}</button>`;
