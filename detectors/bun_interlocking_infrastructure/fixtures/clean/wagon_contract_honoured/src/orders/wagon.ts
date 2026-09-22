// The wagon names each artifact its plan document declares, so the contract and the
// Cargo it actually moves cannot drift apart.
export const CONSUMES = "orders:priced-basket";
export const PRODUCES = "orders:confirmed-order";

export class Cargo {
  private a: Record<string, unknown> = {};
  put(artifactUrn: string, v: unknown) { this.a[artifactUrn] = v; }
  get(artifactUrn: string) { return this.a[artifactUrn]; }
}

export function runWagon(cargo: Cargo): void {
  const basket = cargo.get(CONSUMES);
  cargo.put(PRODUCES, { confirmed: true, basket });
}
