// calls.mjs — emit-call extraction shared by the raw-string and forbidden-property
// checks. Never spawned as a check (the family runner only spawns checks/*.mjs).
//
// An emit-like call is `emit`, `emitted`, `track`, `capture`, `record`, `logEvent`,
// `emitEvent` or `sendEvent` invoked as a function or method with a STRING LITERAL
// as its first argument. The lookbehind rejects only word-character prefixes, so
// `telemetry.emit(...)` matches while `resubmit(...)` does not. Calls whose first
// argument is computed (a variable, a template literal, a contract constant) are
// invisible to these checks by design: they are what the generated contracts use.

/** Blank line comments and block comments with spaces, preserving every line and column
 * offset. Unlike lib/scan.mjs's maskLiteralsAndComments this KEEPS string literals: they are
 * the payload these checks inspect. */
export function maskComments(text) {
  const out = text.split("");
  const blank = (from, to) => {
    for (let k = from; k < to && k < text.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i], next = text[i + 1];
    if (ch === "/" && next === "/") {
      let j = i;
      while (j < text.length && text[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (ch === "/" && next === "*") {
      let j = text.indexOf("*/", i + 2);
      j = j === -1 ? text.length : j + 2;
      blank(i, j);
      i = j;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === ch || text[j] === "\n") break;
        j++;
      }
      i = text[j] === ch ? j + 1 : j;
    } else {
      i++;
    }
  }
  return out.join("");
}

const EMIT_CALLEE = /(?<![A-Za-z0-9_$])(?:emit|emitted|track|capture|record|logEvent|emitEvent|sendEvent)(?=\s*\()/g;

/** Every emit-like call with a string-literal first argument: {index, value, argEnd}. */
export function emitStringCalls(text) {
  const calls = [];
  for (const callee of text.matchAll(EMIT_CALLEE)) {
    let i = callee.index + callee[0].length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== "(") continue;
    i++;
    while (i < text.length && /\s/.test(text[i])) i++;
    const quote = text[i];
    if (quote !== '"' && quote !== "'") continue;
    let j = i + 1;
    while (j < text.length && text[j] !== quote && text[j] !== "\n") {
      if (text[j] === "\\") j++;
      j++;
    }
    if (text[j] !== quote) continue;
    calls.push({ index: callee.index, value: text.slice(i + 1, j), argEnd: j + 1 });
  }
  return calls;
}

/** Does a string look like a telemetry event NAME (as opposed to a log level or a key)? */
export function looksLikeEventName(value) {
  if (value.startsWith("telemetry:")) return true;
  if (/^[a-z]+(?:_[a-z0-9]+)+$/.test(value)) return true;                                  // order_accepted
  if (/^[a-z][a-zA-Z0-9]*$/.test(value) && /[a-z][A-Z]/.test(value)) return true;           // orderCreated
  if (/^[A-Z][A-Za-z0-9]*(?: [A-Za-z0-9]+)+$/.test(value)) return true;                     // Order Created
  return false;
}

/** The object literal starting at text[from] (already positioned at `{`), or null. */
export function objectLiteralAt(text, from) {
  if (text[from] !== "{") return null;
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch && text[j] !== "\n") {
        if (text[j] === "\\") j++;
        j++;
      }
      i = text[j] === ch ? j : j - 1;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return null;
}

/** Top-level property names of an object-literal text (braces included). Shorthand
 * properties carry no name of their own and are invisible to this scan. */
export function topLevelKeys(objectText) {
  const keys = [];
  let depth = 0, i = 0, atKeyStart = true;
  while (i < objectText.length) {
    const ch = objectText[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < objectText.length && objectText[j] !== ch && objectText[j] !== "\n") {
        if (objectText[j] === "\\") j++;
        j++;
      }
      i = j < objectText.length ? j + 1 : j;
      atKeyStart = false;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") { depth++; i++; atKeyStart = ch === "{" || ch === ","; continue; }
    if (ch === "}" || ch === "]" || ch === ")") { depth--; i++; atKeyStart = false; continue; }
    if (depth === 1 && atKeyStart) {
      const match = /^([A-Za-z_$][\w$]*)\s*:/.exec(objectText.slice(i));
      if (match) {
        keys.push(match[1]);
        i += match[0].length;
        atKeyStart = false;
        continue;
      }
    }
    if (ch === ",") { atKeyStart = true; i++; continue; }
    if (!/[\s:]/.test(ch)) atKeyStart = false;
    i++;
  }
  return keys;
}
