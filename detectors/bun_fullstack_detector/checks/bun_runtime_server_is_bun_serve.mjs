#!/usr/bin/env bun
// Detector: coder.bun.runtime-server-is-bun-serve  (disposition: strict)
//
// A full-stack Bun app serves HTTP with `Bun.serve`, not with Express, Fastify,
// Koa or `node:http`. This is not taste. `Bun.serve` is the only server in this
// stack that gets Bun's native routing, WebSocket upgrade, streaming and
// `HTMLRewriter` — the last of which is how htmx fragments are transformed
// server-side. Running Express under Bun silently opts the app back onto the
// node-compat path: you keep the whole npm middleware dependency surface, lose
// the native primitives, and the deployment story ("bun run server.ts", no
// bundle, no node_modules) stops being true.
//
// Masked source is scanned, so a framework name inside a comment or a string
// (a doc line, an error message, a migration note) never trips the rule.
import { walk, readRoots, readExcludes, readText, emit, locate, maskLiteralsAndComments, SOURCE_EXT } from "../../../lib/scan.mjs";

const RULE_ID = "coder.bun.runtime-server-is-bun-serve";
const FOREIGN_SERVER_RE =
  /\b(?:express\s*\(\s*\)|fastify\s*\(|new\s+Koa\s*\(|http\.createServer\s*\(|https\.createServer\s*\(|createServer\s*\()/g;

const violations = [];
const excludes = readExcludes();
for (const root of readRoots()) {
  for (const file of walk(root, excludes, SOURCE_EXT)) {
    const text = readText(file);
    if (!text) continue;
    const masked = maskLiteralsAndComments(text);
    for (const m of masked.matchAll(FOREIGN_SERVER_RE)) {
      violations.push({
        rule_id: RULE_ID,
        file,
        ...locate(text, m.index),
        evidence: `HTTP server created with ${m[0].replace(/\s*\($/, "").trim()} instead of Bun.serve; the app falls back to node-compat and loses Bun's native routing/HTMLRewriter`,
      });
    }
  }
}
process.stderr.write(`bun-detector[server-uses-bun-serve]: ${violations.length} violation(s)\n`);
emit(violations);
