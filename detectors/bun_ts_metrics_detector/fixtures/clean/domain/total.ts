// Sum a list of numbers.
// Short, shallow and branch-free, so no metric threshold is approached.
export function total(items: number[]): number {
  // A single accumulation loop; cyclomatic complexity stays at 2.
  let sum = 0;
  for (const item of items) sum += item;
  return sum;
}
