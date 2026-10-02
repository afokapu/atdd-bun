// Two modules importing the same names from one shared module is sharing, not duplication:
// the identical specifier lists below must not be reported.
import {
  one,
  two,
  three,
  four,
  five,
  six,
} from "./units";

// Scale a number by every unit.
export const scale = (n: number): number => n * one * two * three * four * five * six;
