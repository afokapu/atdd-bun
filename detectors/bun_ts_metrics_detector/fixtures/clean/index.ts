// Composition root for the clean fixture project.
// Imports every module so nothing is unreachable.
import { total } from "./domain/total";
import { label } from "./domain/label";

// Run the tiny pipeline this fixture represents.
export const run = (xs: number[]): string => label(total(xs));
