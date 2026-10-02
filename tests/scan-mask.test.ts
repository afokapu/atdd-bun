import { expect, test } from "bun:test";
// @ts-expect-error: a plain .mjs module shared by the detectors, without type declarations
import { maskLiteralsAndComments } from "../lib/scan.mjs";

// C1 #uGEFCwywSbHr: a quote inside a regex literal opened a phantom string, and every later token was masked, so the
// security family missed real calls. A regex literal is masked like a string; division is left alone.
test("a quote inside a regex literal does not mask the code after it", () => {
  const masked = maskLiteralsAndComments('const s = "a".replace(/"/g, "");\nconsole.log(s);\n');
  expect(masked).toContain("console.log(s)");
  expect(maskLiteralsAndComments('const h = html.matchAll(/href="([^"]+)"/g);\nconsole.log(h);\n')).toContain("console.log(h)");
  expect(maskLiteralsAndComments('const t = x.replace(/["\\s()]/g, "");\nconsole.warn(t);\n')).toContain("console.warn(t)");
});

test("a regex literal's contents are masked, and division is not a regex", () => {
  expect(maskLiteralsAndComments('const r = /console.log(x)/;\n')).not.toContain("console.log");
  expect(maskLiteralsAndComments('const half = total / 2; console.log(half / 3);\n')).toContain("console.log(half / 3)");
  expect(maskLiteralsAndComments('return /a"b/.test(s) && console.error(s);\n')).toContain("console.error(s)");
});
