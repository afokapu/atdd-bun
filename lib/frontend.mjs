// Frontend settings shared by the responsive and browser-test detectors, read from atdd-bun.yaml:
//
//   frontend:
//     viewports: [375, 768, 1280]          # widths every RESP spec renders at; the smallest bounds fixed widths
//     breakpoints: [480, 768, 1024, 1280]  # the only widths an @media query may use
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_VIEWPORTS = [375, 768, 1280];
export const DEFAULT_BREAKPOINTS = [480, 768, 1024, 1280];

export function frontendConfig(root) {
  let data = {};
  try { data = Bun.YAML.parse(readFileSync(join(root, "atdd-bun.yaml"), "utf8")) ?? {}; } catch {}
  const numbers = (value, fallback) => (Array.isArray(value) && value.length && value.every((v) => Number.isInteger(v) && v > 0) ? [...value].sort((a, b) => a - b) : fallback);
  return { viewports: numbers(data?.frontend?.viewports, DEFAULT_VIEWPORTS), breakpoints: numbers(data?.frontend?.breakpoints, DEFAULT_BREAKPOINTS) };
}
