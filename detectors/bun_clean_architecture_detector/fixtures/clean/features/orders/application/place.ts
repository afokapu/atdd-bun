// Orchestration depends inward on the domain only.
import { total } from "../domain/total";
export const place = (xs: number[], repo: { save: (n: number) => void }) => repo.save(total(xs));
