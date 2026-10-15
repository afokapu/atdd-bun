// Code position, not markup: a comparison against a binding named input, and a
// legacy angle-bracket type assertion, must never read as a rendered control.
export const clamp = (value: number, input: number) => (value<input ? value : input);
export const asElement = (node: unknown) => <input>node;
