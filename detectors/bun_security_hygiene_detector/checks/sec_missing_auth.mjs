#!/usr/bin/env bun
// Member check: coder.bun.security-missing-auth  (security/hygiene family)
//
// RE-REALIZED, NOT PORTED. The python-pytest sibling looks for a FastAPI route
// decorator (`@app.get(...)`) whose signature lacks `Depends(get_current_user)`.
// Bun has no decorators and no dependency-injection container: routes are entries
// in the `routes` object of `Bun.serve`, or branches of a `fetch` handler, and
// authorisation is an ordinary function call at the top of the handler.
//
// So the DETECTION is entirely different while the OBLIGATION is unchanged: a
// state-changing route must not be reachable without an authorisation check.
//
// SCOPE — mutating methods only. A public GET is a normal thing for an htmx app to
// serve (it is how fragments load); a POST/PUT/PATCH/DELETE handler with no auth
// call in its body is the shape that leaks writes.
import { walk, readRoots, readExcludes, readText, emit, locate, SOURCE_EXT } from "../../../lib/scan.mjs";

const RULE = "coder.bun.security-missing-auth";

// A route entry keyed by method inside a Bun.serve `routes` object:
//   "/orders": { POST: async (req) => { ... } }
const ROUTE_METHOD_RE = /\b(POST|PUT|PATCH|DELETE)\s*:\s*(?:async\s*)?\(/g;
// A method guard inside a fetch handler: `if (req.method === "POST")`.
const METHOD_GUARD_RE = /req(?:uest)?\.method\s*===?\s*["'](POST|PUT|PATCH|DELETE)["']/g;

// Any recognisable authorisation step. Deliberately broad: the rule asks whether
// the author thought about auth at all, not whether they used one blessed helper.
const AUTH_CALL_RE =
  /\b(requireAuth|requireUser|requireSession|authorize|authorise|authenticate|assertAuth|getCurrentUser|getSession|verifyToken|checkPermission|can|guard)\s*\(/;

// Take the handler body following `from`, by brace matching, so the auth check is
// looked for in THIS handler rather than anywhere in the file.
function bodyAfter(text, from) {
  const open = text.indexOf("{", from);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return text.slice(open, i + 1); }
  }
  return text.slice(open);
}

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const text = readText(file);
    if (!text) continue;
    for (const re of [ROUTE_METHOD_RE, METHOD_GUARD_RE]) {
      for (const m of text.matchAll(re)) {
        const body = bodyAfter(text, m.index + m[0].length);
        if (AUTH_CALL_RE.test(body)) continue;
        violations.push({
          rule_id: RULE, file, ...locate(text, m.index),
          evidence: `${m[1]} handler performs no authorisation check; a state-changing route must not be reachable unauthenticated`,
        });
      }
    }
  }
}
process.stderr.write(`bun-security[missing-auth]: ${violations.length} violation(s)\n`);
emit(violations);
