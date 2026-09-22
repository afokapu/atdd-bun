// A deliberately gnarly function to exercise every metric branch.
export function decide(a: number, b: string, c: boolean, d: any[]): string {
  if (a > 1 && b !== "x") {
    for (const item of d) {
      while (item.next) {
        if (item.kind === "a" || item.kind === "b") {
          try { item.run(); } catch (e) { return "err"; }
        } else if (c) {
          switch (item.kind) {
            case "z": return "z";
            case "y": return "y";
            default: break;
          }
        }
      }
    }
  }
  const t = a > 5 ? "big" : "small";
  return t ?? "none";
}

export const short = (x) => x;
