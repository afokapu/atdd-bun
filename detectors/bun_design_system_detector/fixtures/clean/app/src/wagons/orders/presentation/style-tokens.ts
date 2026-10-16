// URN: component:orders:checkout:style-tokens:frontend:presentation
// Tested-By:
// - test:orders:checkout:E001-UNIT-001-design-corpus
// Runtime: bun
// Purpose: design-detector corpus fixture: sanctioned token shapes in .ts literals.
// Tokens in .ts literals: var(--…) references, hairline 0/1px and custom-property
// definitions are the sanctioned shapes; none of these is a finding.
export const panel = '<div style="margin: var(--space-3); padding: 1px;">Total</div>';
export const sheet = `<style>:root { --danger: #b91c1c; --space-1: 4px; }</style>`;
