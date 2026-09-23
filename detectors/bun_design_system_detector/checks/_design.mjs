// Shared design-system model for the bun_design_system_detector family.
//
// A DESIGN ROOT is a directory named `design`, `design_system`, or `design-system`.
// The first directory beneath it names the file's LAYER, bottom to top:
//
//   tokens | foundations  (0)  ←  primitives (1)  ←  components (2)  ←  templates (3)
//
// Imports may point to the same layer or a lower one. Every rule self-scopes: a
// repository with no design root is not judged, because there is no system to
// connect to yet.
import { dirname, extname, normalize, resolve, sep } from "node:path";
import { walk, readText, maskLiteralsAndComments } from "../../../lib/scan.mjs";

export const DESIGN_DIRS = new Set(["design", "design_system", "design-system"]);
export const LAYERS = { tokens: 0, foundations: 0, primitives: 1, components: 2, templates: 3 };
export const UI_EXT = new Set([".tsx", ".jsx", ".html", ".htm", ".css"]);
export const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);
const ALL_EXT = new Set([...UI_EXT, ...CODE_EXT]);

/** The design root containing `file` and the file's layer, or null when outside any design root. */
export function designOf(file) {
  const parts = normalize(file).split(sep);
  for (let i = parts.length - 2; i >= 0; i--) {
    if (!DESIGN_DIRS.has(parts[i])) continue;
    const layerName = parts[i + 1];
    const layer = i + 1 < parts.length - 1 && layerName in LAYERS ? LAYERS[layerName] : null;
    return { root: parts.slice(0, i + 1).join(sep) || sep, layerName: layer === null ? null : layerName, layer };
  }
  return null;
}

/** Every source/UI file under the scan roots, once. */
export function collect(roots, excludes) {
  const seen = new Set();
  for (const root of roots) for (const file of walk(root, excludes, ALL_EXT)) seen.add(resolve(file));
  return [...seen];
}

const IMPORT_RE = /(?:^|[\n;])\s*(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s*from\s*(['"])([^'"]+)\2|(?:^|[\n;])\s*import\s*(['"])([^'"]+)\4|\bimport\(\s*(['"])([^'"]+)\6\s*\)/g;

/** Import statements of a code file: specifier, the clause text, and its offset. */
export function importsOf(text) {
  const out = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const specifier = m[3] ?? m[5] ?? m[7];
    out.push({ specifier, clause: m[1] ?? "", index: m.index + m[0].indexOf(specifier) });
  }
  return out;
}

/**
 * Where an import points: a path for relative specifiers, or — for aliased/absolute
 * specifiers — the design segment it names (`@/design/primitives/Text`). Bare
 * package names resolve to null.
 */
export function target(file, specifier) {
  if (specifier.startsWith(".")) return { path: resolve(dirname(file), specifier) };
  const segments = specifier.split("/");
  const at = segments.findIndex((s) => DESIGN_DIRS.has(s));
  if (at === -1) return null;
  const layerName = segments[at + 1];
  return { alias: true, layerName: layerName in LAYERS ? layerName : null, layer: layerName in LAYERS ? LAYERS[layerName] : null };
}

/** The design location an import resolves into, or null when it leaves every design root. */
export function designTarget(file, specifier) {
  const t = target(file, specifier);
  if (!t) return null;
  if (t.alias) return { layer: t.layer, layerName: t.layerName };
  const d = designOf(t.path + (extname(t.path) ? "" : sep + "_"));
  return d ? { layer: d.layer, layerName: d.layerName, root: d.root, path: t.path } : null;
}

export function masked(file) {
  const text = readText(file);
  if (text === null) return null;
  return { text, code: extname(file) === ".css" ? text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")) : maskLiteralsAndComments(text) };
}

export const isUi = (file) => UI_EXT.has(extname(file));
export const isComponentSource = (file) => extname(file) === ".tsx" || extname(file) === ".jsx";
export const hasDesignRoot = (files) => files.some((file) => designOf(file));

const kebab = (prop) => prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const CSS_DECL_RE = /([-a-zA-Z]+)\s*:\s*([^;{}]+)(?=[;}])/g;

/**
 * Property/value pairs written in a UI file, with absolute offsets. CSS declarations
 * must end in `;` or `}` so selectors (`a:hover {`) are never read as values; JSX
 * style-object keys are converted to kebab-case, and a bare number is kept as-is.
 */
export function declarations(file, text) {
  const out = [];
  const css = (body, offset) => { for (const m of body.matchAll(CSS_DECL_RE)) out.push({ prop: m[1].toLowerCase(), value: m[2].trim(), index: offset + m.index }); };
  if (extname(file) === ".css") { css(text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")), 0); return out; }
  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) css(m[1], m.index + m[0].indexOf(m[1]));
  for (const m of text.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/g)) css(m[2] + ";", m.index + m[0].indexOf(m[2]));
  for (const m of text.matchAll(/\bstyle\s*=\s*\{\{/g)) {
    let depth = 0, j = m.index + m[0].length - 2;
    for (; j < text.length; j++) { if (text[j] === "{") depth++; else if (text[j] === "}" && --depth === 0) break; }
    const body = text.slice(m.index, j + 1);
    for (const d of body.matchAll(/([A-Za-z]+)\s*:\s*(?:(["'`])([^"'`]*)\2|(-?\d+(?:\.\d+)?)\b)/g)) out.push({ prop: kebab(d[1]), value: d[3] ?? d[4], numeric: d[4] !== undefined, index: m.index + d.index });
  }
  for (const m of text.matchAll(/\b(fill|stroke|bgcolor)\s*=\s*(["'])([^"']*)\2/g)) out.push({ prop: m[1], value: m[3], index: m.index });
  return out;
}

/** Run a check over the scan roots, self-scoped to repositories that have a design root. */
export function scope(roots, excludes) {
  const files = collect(roots, excludes);
  return hasDesignRoot(files) ? files : [];
}
