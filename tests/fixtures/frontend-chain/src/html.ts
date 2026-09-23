/** Escape a value for HTML text or an attribute. */
export const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Mark markup that was composed from escaped parts, so a template can embed it. */
export const fragment = (markup: string) => markup;
