import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const template = join(root, "templates/claude/atdd/SKILL.md");
const version = (await Bun.file(join(root, "package.json")).json() as { version: string }).version;
const skillDir = (repo: string) => join(repo, ".claude/skills/atdd");
export async function agentInit(repo = process.cwd(), replace = false) { const output = join(skillDir(repo), "SKILL.md"); if (existsSync(output) && !replace) return { ok: false, message: `${output} exists; use --replace` }; await mkdir(skillDir(repo), { recursive: true }); await writeFile(output, (await readFile(template, "utf8")).replace("{{VERSION}}", version)); return { ok: true, message: output }; }
export async function agentStatus(repo = process.cwd()) { const output = join(skillDir(repo), "SKILL.md"); return { ok: existsSync(output), message: output }; }
