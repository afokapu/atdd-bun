import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const template = join(root, "templates/github/atdd-bun.yml");
const version = (await Bun.file(join(root, "package.json")).json() as { version: string }).version;
export async function ciInit(repo = process.cwd(), replace = false) { const output = join(repo, ".github/workflows/atdd-bun.yml"); if (existsSync(output) && !replace) return { ok: false, message: `${output} exists; use --replace` }; await mkdir(join(repo, ".github/workflows"), { recursive: true }); await writeFile(output, (await readFile(template, "utf8")).replace("{{VERSION}}", version)); return { ok: true, message: output }; }
export async function ciStatus(repo = process.cwd()) { const output = join(repo, ".github/workflows/atdd-bun.yml"); return { ok: existsSync(output), message: output }; }
