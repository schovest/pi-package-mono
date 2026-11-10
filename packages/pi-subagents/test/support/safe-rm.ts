/**
 * Resilient directory removal for test cleanup.
 *
 * Integration tests share their temp run directories with spawned runner
 * processes, child sessions, and the in-test parent finalize path, so a
 * plain `fs.rmSync(dir, { recursive: true, force: true })` can race a live
 * writer: the directory gains entries between readdir and rmdir and Node
 * throws ENOTEMPTY. Small maxRetries windows (observed: 5 x 20ms) do not
 * outlive post-result teardown writes on loaded CI runners. This helper
 * retries with backoff over a window long enough to outlive those writers,
 * and dumps the surviving entries when it still fails so the leftover
 * writer can be identified from the failure alone.
 */
import * as fs from "node:fs";

const MAX_ATTEMPTS = 12;
const RETRY_DELAY_MS = 200;

/** Synchronous sleep: cleanup runs in afterEach/finally blocks, where awaiting is not available. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function removeDirSyncSafe(dir: string): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOTEMPTY" && code !== "EBUSY" && code !== "EPERM") throw error;
      if (attempt + 1 < MAX_ATTEMPTS) sleepSync(RETRY_DELAY_MS);
    }
  }
  let leftovers: unknown;
  try {
    leftovers = fs.readdirSync(dir).slice(0, 32);
  } catch {
    leftovers = "unreadable";
  }
  throw new Error(
    `removeDirSyncSafe: failed to remove '${dir}' after ${MAX_ATTEMPTS} attempts; surviving entries: ${JSON.stringify(leftovers)}`,
    { cause: lastError },
  );
}
