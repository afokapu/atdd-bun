// The mutating affordance posts to a path the Station Master routes.
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const OrderRow = (id: string) =>
  `<li id="order-${escapeHtml(id)}"><button hx-post="/orders/confirm" hx-confirm="Confirm?" hx-indicator="#spinner">Confirm</button></li>`;
