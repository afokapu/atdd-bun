// Presentation receives collaborators; it constructs none and fetches nothing.
import { place } from "../application/place";
export const handler = (repo: { save: (n: number) => void }) => (xs: number[]) => place(xs, repo);
