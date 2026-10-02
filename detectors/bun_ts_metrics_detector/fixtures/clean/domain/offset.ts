// The twin of scale.ts's import list, with a different body.
import {
  one,
  two,
  three,
  four,
  five,
  six,
} from "./units";

// Shift a number by every unit.
export const offset = (n: number): number => n + one + two + three + four + five + six;
