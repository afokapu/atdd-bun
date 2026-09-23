#!/usr/bin/env bun
// Check: coder.bun.station-master-journey-routing (disposition: strict)
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  parseJsonEnv,
  readText,
  findConsumerRoots,
  appFile,
  referencesToken,
  lineAt,
  lineOfIndex,
  mk,
  writeReport,
  maskComments,
  PLAN_ROOT,
} from "../_shared/interlocking.mjs";

const RULE = "coder.bun.station-master-journey-routing";
const roots = parseJsonEnv("ATDD_SCAN_ROOTS", []);
const violations = [];

function escapeRegExp(value) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function journeyDocuments(croot) {
  const base = join(croot, PLAN_ROOT, "_journeys");
  if (!existsSync(base)) return [];
  const out = [], stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), st = statSync(path);
      if (st.isDirectory()) stack.push(path);
      else if (/\.ya?ml$/.test(name)) {
        try {
          const data = Bun.YAML.parse(readText(path));
          if (data && typeof data === "object") out.push({
            file: relative(croot, path).replaceAll("\\", "/"),
            data,
          });
        } catch {}
      }
    }
  }
  return out;
}

function actionMapping(text, action) {
  const masked = maskComments(text);
  const key = escapeRegExp(action);
  const re = new RegExp("(?:[\\\"']" + key + "[\\\"']|\\b" + key + "\\b)\\s*:\\s*\\{([\\s\\S]*?)\\}", "m");
  const match = re.exec(masked);
  if (!match) return null;
  return { body: match[1], line: lineOfIndex(masked, match.index) };
}

for (const scanRoot of roots) {
  for (const croot of findConsumerRoots(scanRoot)) {
    const journeys = journeyDocuments(croot).filter(item => item.data?.entrypoint?.exposed === true);
    if (journeys.length === 0) continue;

    const app = appFile(croot);
    if (!app) {
      for (const journey of journeys) violations.push(mk(
        RULE,
        journey.file,
        1,
        0,
        "journey-station-missing: exposed journey has no server.ts Station Master composition root",
        "",
      ));
      continue;
    }

    const text = readText(app);
    const appPath = relative(croot, app).replaceAll("\\", "/");
    if (!referencesToken(text, "JourneyRunner")) violations.push(mk(
      RULE,
      appPath,
      1,
      0,
      "journey-station-unlinked: exposed journeys exist but Station Master never references JourneyRunner",
      lineAt(text, 1),
    ));

    for (const journey of journeys) {
      const id = String(journey.data.journey_id ?? "");
      const actions = Array.isArray(journey.data?.entrypoint?.actions) ? journey.data.entrypoint.actions : [];
      for (const action of actions) {
        const mapping = actionMapping(text, String(action));
        if (!mapping) {
          violations.push(mk(
            RULE,
            appPath,
            1,
            0,
            "journey-station-action-missing: action " + action + " does not appear in JOURNEY_MAP for " + id,
            lineAt(text, 1),
          ));
          continue;
        }
        const hasId = mapping.body.includes(id);
        const hasPath = mapping.body.includes(journey.file);
        const hasJourneyKey = /\bjourney(?:Id|_id)\b/.test(mapping.body);
        if (!hasId || !hasPath || !hasJourneyKey) violations.push(mk(
          RULE,
          appPath,
          mapping.line,
          0,
          "journey-station-binding-mismatch: action " + action + " must map to {journeyId: " + id + ", path: " + journey.file + "}",
          lineAt(text, mapping.line),
        ));
      }
    }
  }
}

writeReport(violations);
