// URN: component:orders:checkout:code-position:frontend:presentation
// Tested-By:
// - test:orders:checkout:E001-UNIT-001-design-corpus
// Runtime: bun
// Purpose: design-detector corpus fixture: code-position negative.
// Code position, not markup: a comparison against a binding named input, and a
// legacy angle-bracket type assertion, must never read as a rendered control.
export const clamp = (value: number, input: number) => (value<input ? value : input);
export const asElement = (node: unknown) => <input>node;
