// Pure rules: no transport, no framework, no outward imports.
export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
