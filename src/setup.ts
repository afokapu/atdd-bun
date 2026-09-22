import { ciInit, ciStatus } from "./ci";
import { hooksStatus, installHooks } from "./hooks";
import { agentInit, agentStatus } from "./agent";

/** Install the package's three opt-in local surfaces without touching unrelated
 * workflows or hook paths. Dependency installation itself never calls this. */
export async function initializeRepository(root = process.cwd(), replace = false) {
  const existingHooks = await hooksStatus(root);
  const hooks = replace || !existingHooks.ok ? await installHooks(root, replace) : existingHooks;
  if (!hooks.ok) return { ok: false, message: `hooks: ${hooks.message}` };

  const existingCi = await ciStatus(root);
  const ci = replace || !existingCi.ok ? await ciInit(root, replace) : existingCi;
  if (!ci.ok) return { ok: false, message: `CI workflow: ${ci.message}` };

  const existingAgent = await agentStatus(root);
  const agent = replace || !existingAgent.ok ? await agentInit(root, replace) : existingAgent;
  if (!agent.ok) return { ok: false, message: `agent skill: ${agent.message}` };
  return { ok: true, message: `hooks: ${hooks.message}\nCI workflow: ${ci.message}\nagent skill: ${agent.message}` };
}
