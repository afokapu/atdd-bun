import { decide } from "./gnarly";
import { longOne } from "./long";
import { dense0 } from "./big";
import { bare } from "./bare";
import { consume } from "./consumer";
import { processA } from "./domain/a";
import { processB } from "./domain/b";
export const run = () => [decide, longOne, dense0, bare, consume, processA, processB];
