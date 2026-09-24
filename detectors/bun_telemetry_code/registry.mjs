// registry.mjs — the tracking-plan registry as the code-side checks see it.
//
// Shared by every member check so all four judge the SAME registry: the concrete
// item ids declared under the telemetry root, and each item's forbidden-property
// list (normalized, so a plan's raw_payload meets code's rawPayload). Loaded once
// per detector run from the package's own loader, which also carries the adoption
// gate: until the repository adopts the capability, every check emits nothing.
import { loadTelemetryFiles, CONCRETE_URN } from "../../src/telemetry-plan.ts";

/** Property names cross vocabulary boundaries: the plan writes snake_case, code writes camelCase. */
export const normalizeName = (name) => name.replace(/[_-]/g, "").toLowerCase();

let cache = null;
export async function registry() {
  if (cache) return cache;
  const roots = JSON.parse(process.env.ATDD_SCAN_ROOTS ?? "[]");
  const loaded = await Promise.all(roots.map((root) => loadTelemetryFiles(root)));
  const ids = new Set();
  const forbidden = new Map();
  for (const { files } of loaded) {
    for (const file of files) {
      if (!file.data) continue;
      const id = typeof file.data.id === "string" ? file.data.id : "";
      if (!id) continue;
      ids.add(id);
      const names = Array.isArray(file.data.forbidden_properties) ? file.data.forbidden_properties.filter((name) => typeof name === "string") : [];
      forbidden.set(id, new Set(names.map(normalizeName)));
    }
  }
  cache = { adopted: loaded.some((result) => result.adopted), ids, forbidden, concreteUrn: CONCRETE_URN };
  return cache;
}
