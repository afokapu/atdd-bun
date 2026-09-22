// match wagon — CLEAN fixture. A wagon transforms artifacts. It reads and returns a data map and
// does NOT import interlocking code (Cargo boundary, core afokapu/atdd#1251).
export function runMatch(cargo: Map<string, unknown>): Map<string, unknown> {
  cargo.set("match", { result: { validForRanked: true } });
  return cargo;
}
