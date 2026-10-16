// URN: component:design:primitives:input-strings:frontend:presentation
// Tested-By:
// - test:orders:checkout:E001-UNIT-001-design-corpus
// Runtime: bun
// Purpose: design-detector corpus fixture: design-root literal HTML is exempt.
// The design system's own primitives render the raw elements: HTML strings
// authored inside the design root are the system itself, not app code.
export const textInput = '<input type="text" class="text-input">';
export const multiline = '<textarea class="text-area"></textarea>';
