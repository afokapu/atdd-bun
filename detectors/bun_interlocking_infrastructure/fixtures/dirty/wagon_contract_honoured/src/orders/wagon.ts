// BUG: the plan declares produce "orders:confirmed-order" and consume
// "orders:priced-basket"; this wagon moves Cargo under ad-hoc keys instead, so the
// declared contract describes artifacts the code never touches.
export class Cargo {
  private a: Record<string, unknown> = {};
  put(artifactUrn: string, v: unknown) { this.a[artifactUrn] = v; }
  get(artifactUrn: string) { return this.a[artifactUrn]; }
}

export function runWagon(cargo: Cargo): void {
  const basket = cargo.get("basket");
  cargo.put("done", { confirmed: true, basket });
}
