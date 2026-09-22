import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const version = (await Bun.file(join(root, "package.json")).json() as { version: string }).version;
const render = async (path: string) => (await readFile(join(root, "templates/agents", path), "utf8")).replace("{{VERSION}}", version);
// .agents/skills is the vendor-neutral Agent Skills path (Codex, Copilot, Cursor, Gemini CLI, …); .claude/skills is Claude Code's.
const skillPaths = [".agents/skills/atdd/SKILL.md", ".claude/skills/atdd/SKILL.md"];
const block = /<!-- atdd-bun:start[\s\S]*?<!-- atdd-bun:end -->\n?/;

/** Write the ATDD skill for every agent and a managed pointer block in AGENTS.md. Existing files and an
 * existing block are kept unless `replace`; the rest of AGENTS.md is never touched. */
export async function agentInit(repo = process.cwd(), replace = false) {
  const written: string[] = [], kept: string[] = [];
  for (const path of skillPaths) {
    const output = join(repo, path);
    if (existsSync(output) && !replace) { kept.push(output); continue; }
    await mkdir(dirname(output), { recursive: true }); await writeFile(output, await render("atdd/SKILL.md")); written.push(output);
  }
  const agents = join(repo, "AGENTS.md"), current = existsSync(agents) ? await readFile(agents, "utf8") : "", managed = await render("AGENTS.block.md");
  if (block.test(current) && !replace) kept.push(agents);
  else { await writeFile(agents, block.test(current) ? current.replace(block, managed) : current + (current && !current.endsWith("\n\n") ? (current.endsWith("\n") ? "\n" : "\n\n") : "") + managed); written.push(agents); }
  if (!written.length) return { ok: false, message: `${kept.join(", ")} exist; use --replace` };
  return { ok: true, message: written.join("\n") };
}
export async function agentStatus(repo = process.cwd()) {
  const agents = join(repo, "AGENTS.md"), missing = skillPaths.map(path => join(repo, path)).filter(path => !existsSync(path));
  if (!existsSync(agents) || !block.test(await readFile(agents, "utf8"))) missing.push(`${agents} (atdd-bun block)`);
  return { ok: !missing.length, message: missing.length ? `missing: ${missing.join(", ")}` : [...skillPaths, "AGENTS.md"].map(path => join(repo, path)).join("\n") };
}
