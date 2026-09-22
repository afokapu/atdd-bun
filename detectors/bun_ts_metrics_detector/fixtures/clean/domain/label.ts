// Render a number as a human label.
// Deliberately unlike total.ts so no fragment fingerprint collides.
export function label(value: number): string {
  // One ternary; well under every threshold.
  return value > 0 ? `positive ${value}` : "none";
}
