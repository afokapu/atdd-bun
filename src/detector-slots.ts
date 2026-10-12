import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";

// Detector concurrency is resource control, never verification: it changes when detectors run, not what they find.

/** A positive integer from the environment, else `fallback`. Any other value fails closed. */
export function detectorLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  return Number(raw);
}

/** How many detectors one run may have in flight. */
export const runDetectorLimit = () => detectorLimit("ATDD_BUN_MAX_DETECTORS", Math.max(2, Math.floor(availableParallelism() / 2)));
/** How many detectors all atdd-bun runs on this host may have in flight together. */
export const hostDetectorLimit = () => detectorLimit("ATDD_BUN_HOST_DETECTORS", availableParallelism());
const slotDirectory = () => process.env.ATDD_BUN_DETECTOR_SLOTS_DIR ?? join(tmpdir(), "atdd-bun-detector-slots");

/** Map `work` over `items` with at most `limit` in flight; results keep the order of `items`. */
export async function pooled<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const index = next++; results[index] = await work(items[index]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return errorCode(error) === "EPERM"; } };
const ownerPid = async (path: string) => Number((await readFile(path, "utf8").catch(() => "")).split(" ")[0]) || undefined;

/** Hard-link the fully written claim to the slot path: atomic and exclusive, like O_EXCL, so a reader never sees a half-written owner. */
async function claim(staging: string, slot: string): Promise<boolean> {
  try { await link(staging, slot); return true; } catch (error) { if (errorCode(error) === "EEXIST") return false; throw error; }
}

/** Free a slot whose owner process is gone. Moving it aside first means two reclaimers cannot both delete it; a slot
 * re-claimed by a live process in the meantime is put back. */
async function reclaimIfDead(slot: string, token: string): Promise<void> {
  const owner = await ownerPid(slot);
  if (owner === undefined || alive(owner)) return;
  const aside = `${slot}.reclaim-${token.replace(" ", "-")}`;
  try { await rename(slot, aside); } catch { return; }
  const moved = await ownerPid(aside);
  if (moved !== undefined && alive(moved)) await link(aside, slot).catch(() => undefined);
  await rm(aside, { force: true });
}

const warned = new Set<string>();
function warnUnusable(directory: string, error: unknown): void {
  if (warned.has(directory)) return;
  warned.add(directory);
  process.stderr.write(`atdd-bun: detector slot directory ${directory} is unusable (${(error as Error).message}); bounding detectors by the per-run cap only\n`);
}

/** Take one of the host-wide detector slots, waiting with a small backoff while all are held. Returns the release.
 * A slot directory that cannot be used at all degrades to the per-run cap, reported on stderr. */
async function acquireHostSlot(): Promise<() => Promise<void>> {
  const limit = hostDetectorLimit(), directory = slotDirectory();
  const token = `${process.pid} ${crypto.randomUUID()}`, staging = join(directory, `.claim-${token.replace(" ", "-")}`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(staging, token);
    for (let delay = 5; ; delay = Math.min(delay * 2, 200)) {
      for (let index = 0; index < limit; index++) {
        const slot = join(directory, `slot-${index}`);
        if (await claim(staging, slot)) return () => release(slot, token);
        await reclaimIfDead(slot, token);
        if (await claim(staging, slot)) return () => release(slot, token);
      }
      await Bun.sleep(delay);
    }
  } catch (error) {
    warnUnusable(directory, error);
    return async () => undefined;
  } finally {
    await rm(staging, { force: true }).catch(() => undefined);
  }
}

/** Release only a slot this claim still owns. */
async function release(slot: string, token: string): Promise<void> {
  if (await readFile(slot, "utf8").catch(() => "") === token) await rm(slot, { force: true });
}

/** Run `work` while holding one host-wide detector slot. */
export async function withHostSlot<T>(work: () => Promise<T>): Promise<T> {
  const release = await acquireHostSlot();
  try { return await work(); } finally { await release(); }
}
