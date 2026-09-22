// A SECOND package in the same tree, also without a typechecker.
//
// It exists because the check originally examined only the FIRST package.json it
// walked into, so a monorepo — a common Bun shape — had one package audited and the
// rest silently ignored. Worse, `readdirSync` is unsorted, so WHICH package got
// checked varied by filesystem: CI and a laptop could disagree about a clean repo.
// Every package.json is now its own project root, and the walk is sorted.
export const second = 1;
