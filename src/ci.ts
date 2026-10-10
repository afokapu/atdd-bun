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
const githubPackagesRegistry = /^\s*@[\w.-]+:registry\s*=\s*https:\/\/npm\.pkg\.github\.com\/?\s*$/im;
const githubPackagesAuth = /^\s*\/\/npm\.pkg\.github\.com\/:_authToken\s*=\s*(.*?)\s*$/im;
const githubPackagesTokenInterpolation = "${NODE_AUTH_TOKEN}";

/** Add only the npm-compatible environment interpolation required by an already-declared GitHub Packages scope.
 * Registry ownership remains with the consumer: absent or other registry scopes are never invented or changed. */
async function githubPackagesNpmrc(repo: string) {
  const path = join(repo, ".npmrc");
  if (!existsSync(path)) return { ok: true, path, content: undefined as string | undefined };
  const content = await readFile(path, "utf8");
  if (!githubPackagesRegistry.test(content)) return { ok: true, path, content: undefined as string | undefined };
  const current = githubPackagesAuth.exec(content)?.[1];
  if (current !== undefined && current !== githubPackagesTokenInterpolation) return { ok: false, path, message: ".npmrc already configures npm.pkg.github.com authentication; replace it with the standard ${NODE_AUTH_TOKEN} interpolation instead of storing a credential" };
  if (current !== undefined) return { ok: true, path, content: undefined as string | undefined };
  return { ok: true, path, content: `${content}${content.endsWith("\n") ? "" : "\n"}//npm.pkg.github.com/:_authToken=${githubPackagesTokenInterpolation}\n` };
}

export async function ciInit(repo = process.cwd(), replace = false) {
  const output = join(repo, ".github/workflows/atdd-bun.yml");
  if (existsSync(output) && !replace) return { ok: false, message: `${output} exists; use --replace` };
  let rendered: string;
  try { rendered = await renderWorkflow(repo); } catch (error) { return { ok: false, message: `atdd-bun.yaml could not be parsed, so the workflow's push branches are unknown; fix the file first: ${String(error)}` }; }
  const npmrc = await githubPackagesNpmrc(repo);
  if (!npmrc.ok) return { ok: false, message: `${npmrc.path}: ${npmrc.message}` };
  await mkdir(join(repo, ".github/workflows"), { recursive: true });
  if (npmrc.content !== undefined) await writeFile(npmrc.path, npmrc.content);
  await writeFile(output, rendered);
  return { ok: true, message: npmrc.content === undefined ? output : `${output}\n${npmrc.path}` };
}
export async function ciStatus(repo = process.cwd()) { const output = join(repo, ".github/workflows/atdd-bun.yml"); return { ok: existsSync(output), message: output }; }
