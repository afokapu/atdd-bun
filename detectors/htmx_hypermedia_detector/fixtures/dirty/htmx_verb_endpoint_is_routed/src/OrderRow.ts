// BUG: the markup mints a state-changing route the Station Master never admits.
// The confirm and indicator satisfy the other htmx rules, and a test can exercise the
// markup, so before this rule the button posted into nothing and everything passed.
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const OrderRow = (id: string) =>
  `<li id="order-${escapeHtml(id)}"><button hx-post="/orders/void-all" hx-confirm="Void?" hx-indicator="#spinner">Void</button></li>`;
