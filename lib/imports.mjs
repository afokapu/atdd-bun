// imports.mjs — module import graph + architectural layer resolution, shared by
// every detector in this provider that reasons about structure rather than text.
//
// Extracted from bun_ts_metrics_detector/ts_metrics.mjs when the clean-architecture
// family needed the same graph: two copies of an import resolver is precisely what
// `coder.bun.duplication-intra-layer` exists to refuse, and a detector suite that
// violates its own rules has no standing.
import { extname, dirname, resolve as resolvePath, basename, sep } from "node:path";

// Bun ships a real TypeScript parser in-process, so the graph omits type-only
// imports — erased at compile time, therefore not runtime edges. The regex set is
// the fallback for a file the parser cannot read, matching what a Python detector
// would see.
const FALLBACK_IMPORT_RES = [
  /(?:^|\n)\s*import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*export\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function moduleImports(source, file) {
  try {
    const loader = extname(file) === ".tsx" ? "tsx" : "ts";
    return new Bun.Transpiler({ loader }).scan(source).imports.map((i) => i.path);
  } catch {
    const found = new Set();
    for (const re of FALLBACK_IMPORT_RES) {
      for (const m of source.matchAll(re)) found.add(m[1]);
    }
    return [...found];
  }
}

// Import records INCLUDING type-only ones. The clean-architecture rules need these:
// a layering violation is a violation even when the import is erased, because the
// dependency it encodes is a real design coupling that a reader must follow.
export function allImportSpecifiers(source) {
  const found = new Set();
  for (const re of FALLBACK_IMPORT_RES) {
    for (const m of source.matchAll(re)) found.add(m[1]);
  }
  return [...found];
}

export const LAYERS = ["domain", "application", "integration", "presentation", "assembly"];

// The layer a path belongs to, read from its directory segments. Returns null when
// the path carries no layer segment — an unlayered file is outside these rules
// rather than in violation of them.
export function layerOf(path) {
  const segs = path.toLowerCase().split(/[\\/]/);
  for (const l of LAYERS) if (segs.includes(l)) return l;
  return null;
}

// The commons/shared root a path sits under, or null.
export function commonsRootOf(path) {
  const segs = path.toLowerCase().split(/[\\/]/);
  const i = segs.findIndex((s) => s === "commons" || s === "shared");
  return i === -1 ? null : segs[i];
}

// The feature subdirectory directly under `commons/<layer>/`, or null.
export function commonsFeatureOf(path) {
  const segs = path.toLowerCase().split(/[\\/]/);
  const i = segs.findIndex((s) => s === "commons" || s === "shared");
  if (i === -1) return null;
  const layer = segs[i + 1];
  if (!LAYERS.includes(layer)) return null;
  return segs[i + 2] && !/\.[cm]?[jt]sx?$/.test(segs[i + 2]) ? segs[i + 2] : null;
}

// Resolve a relative or `@/`-aliased specifier against a file, WITHOUT requiring
// the target to exist: the layering rules judge the declared dependency, and a
// broken import is `dead-code-reachability`'s finding, not theirs.
export function resolveSpecifier(specifier, sourceFile, root) {
  if (specifier.startsWith(".")) return resolvePath(dirname(sourceFile), specifier);
  if (specifier.startsWith("@/")) return resolvePath(root, specifier.slice(2));
  return null;   // bare npm specifier — outside the project graph
}

export { basename, sep, extname };
