export class Cargo {
  private values = new Map<string, unknown>();
  get(key: string) { return this.values.get(key); }
  put(key: string, value: unknown) { this.values.set(key, value); }
}
export function runOrder(cargo: Cargo) { cargo.put("order:prepared", { id: "order-1" }); }
export function runReceipt(cargo: Cargo) { cargo.get("order:prepared"); cargo.put("receipt:issued", { id: "receipt-1" }); }
