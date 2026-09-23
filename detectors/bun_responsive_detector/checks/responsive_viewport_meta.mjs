#!/usr/bin/env bun
// coder.bun.responsive-viewport-meta: every full HTML document declares a device-width viewport and never blocks zoom.
import { runCheck } from "./_responsive.mjs";
const RULE = "coder.bun.responsive-viewport-meta";
runCheck("responsive-viewport-meta", (root, files, report) => {
  for (const { file, text } of files) {
    const html = text.search(/<html[\s>]/i);
    if (file.endsWith(".css") || html === -1) continue;
    const meta = [...text.matchAll(/<meta\b[^>]*>/gi)].find((m) => /name\s*=\s*["']viewport["']/i.test(m[0]));
    // A head assembled from a partial (`<head>${head}</head>`, `<head>{head}</head>`) is judged where the partial is written.
    const head = text.slice(html).match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
    if (!meta && /\$\{|\{/.test(head)) continue;
    if (!meta) { report(RULE, file, text, html, 'document has no <meta name="viewport" content="width=device-width, initial-scale=1">; phones render it as a zoomed-out desktop page'); continue; }
    if (/content\s*=\s*\{/.test(meta[0])) continue; // a JSX expression is not statically known; its presence is enough
    const content = meta[0].match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    if (!/width\s*=\s*device-width/i.test(content)) report(RULE, file, text, meta.index, `viewport content "${content}" does not set width=device-width`);
    const scale = content.match(/maximum-scale\s*=\s*([\d.]+)/i);
    if (/user-scalable\s*=\s*(no|0)\b/i.test(content) || (scale && Number(scale[1]) < 2)) report(RULE, file, text, meta.index, `viewport content "${content}" blocks zoom (user-scalable=no or maximum-scale below 2), which fails users who need to enlarge text`);
  }
});
