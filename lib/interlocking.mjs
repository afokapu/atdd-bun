// The interlocking document (plan/_trains/_interlockings/<id>.yaml), read with a YAML parser. Detectors once scanned
// it line by line and stopped at the first line in column 0 after `routes:`, so a compact list (`routes:` then
// `- route_id:` at column 0, the same YAML) parsed to no routes and every route rule passed without judging anything
// (FWS, atdd-maintainer #G3aXIPPW1Mz5). Line numbers, which findings cite, are looked up in the text afterwards.

const scalar = (value) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : null);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** { interlockingId, routes: [{ routeId, line, sourceLine, trainId, trainPath, category }], exposed, actions, rawText },
 * or null for a document with no interlocking_id or no routes (registries and projections). */
export function parseInterlocking(text) {
  let doc;
  try { doc = Bun.YAML.parse(text); } catch { return null; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const interlockingId = scalar(doc.interlocking_id);
  if (!interlockingId) return null;
  const lines = text.split(/\r?\n/), taken = new Set();
  const lineOf = (routeId) => {
    const pattern = new RegExp(`^\\s*(?:-\\s*)?route_id:\\s*["']?${escape(routeId)}["']?\\s*(?:#.*)?$`);
    const index = lines.findIndex((line, i) => !taken.has(i) && pattern.test(line));
    if (index >= 0) taken.add(index);
    return index;
  };
  const routes = (Array.isArray(doc.routes) ? doc.routes : []).flatMap((route) => {
    const routeId = route && typeof route === "object" ? scalar(route.route_id) : null;
    if (!routeId) return [];
    const index = lineOf(routeId);
    return [{ routeId, line: index >= 0 ? index + 1 : 1, sourceLine: index >= 0 ? lines[index] : "", trainId: scalar(route.train_id), trainPath: scalar(route.train_path), category: scalar(route.category) }];
  });
  if (!routes.length) return null;
  const entrypoint = doc.entrypoint && typeof doc.entrypoint === "object" ? doc.entrypoint : {};
  const actions = (Array.isArray(entrypoint.actions) ? entrypoint.actions : []).map(scalar).filter(Boolean);
  return { interlockingId, routes, exposed: entrypoint.exposed === true, actions, rawText: text };
}
