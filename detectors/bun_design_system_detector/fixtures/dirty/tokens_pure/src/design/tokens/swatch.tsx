import { jsx } from "hono/jsx";

export const dark = process.env.THEME === "dark";
export function tone(level: number) {
  if (level > 2) return "var(--ink)";
  return "var(--ink-2)";
}
export const Swatch = () => <div class="swatch" />;
void jsx;
