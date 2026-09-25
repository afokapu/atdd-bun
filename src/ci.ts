import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { policy } from "./hooks";

const root = resolve(import.meta.dir, "..");
const template = join(root, "templates/github/atdd-bun.yml");
const version = (await Bun.file(join(root, "package.json")).json() as { version: string }).version;
/** The workflow for this repository: pushes to its protected branches run the post-merge checks, so a repository
 * whose base branch is not main or master is covered too. The integrity check compares against this same rendering.
 * Each branch is written as a JSON string, a YAML scalar a branch name can never break out of. */
export async function renderWorkflow(repo = process.cwd()) {
  return (await readFile(template, "utf8")).replace("{{VERSION}}", version).replace("{{PROTECTED_BRANCHES}}", (await policy(repo)).protected_branches.map(branch => JSON.stringify(branch)).join(", "));
}
export async function ciInit(repo = process.cwd(), replace = false) { const output = join(repo, ".github/workflows/atdd-bun.yml"); if (existsSync(output) && !replace) return { ok: false, message: `${output} exists; use --replace` }; let rendered: string; try { rendered = await renderWorkflow(repo); } catch (error) { return { ok: false, message: `atdd-bun.yaml could not be parsed, so the workflow's push branches are unknown; fix the file first: ${String(error)}` }; } await mkdir(join(repo, ".github/workflows"), { recursive: true }); await writeFile(output, rendered); return { ok: true, message: output }; }
export async function ciStatus(repo = process.cwd()) { const output = join(repo, ".github/workflows/atdd-bun.yml"); return { ok: existsSync(output), message: output }; }
