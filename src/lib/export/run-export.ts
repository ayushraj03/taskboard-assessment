import { classifyError, type ClassifiedError } from "./classify";
import type { ExportFailure, ExportOutcome, ExportProgress, ExportRow, ExportTarget } from "./types";

export type RunExportOptions = {
  /** attempts per call, including the first (default 4) */
  maxAttempts?: number;
  /** base delay for exponential backoff on transient errors (default 500ms) */
  baseDelayMs?: number;
  /** called after every batch; lets the caller persist progress */
  onProgress?: (progress: ExportProgress) => Promise<void> | void;
  /** injectable for tests */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

type CallResult = { ok: true } | { ok: false; error: ClassifiedError };

class FatalExportError extends Error {}

/**
 * Pushes rows to `target` in batches with:
 *  - throttling to the target's rate limit
 *  - bounded exponential backoff for transient errors
 *  - no retries for permanent errors; a failing batch is split into single
 *    rows so one bad record doesn't sink the other nine
 *  - an immediate abort on fatal (config) errors
 *
 * Never throws for target errors: the outcome says what happened.
 */
export async function runExport(
  rows: ExportRow[],
  target: ExportTarget,
  opts: RunExportOptions = {},
): Promise<ExportOutcome> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;

  const progress: ExportProgress = { total: rows.length, exported: 0, failed: 0, failures: [] };
  let lastCallAt = -Infinity;

  async function throttle() {
    const wait = lastCallAt + target.minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastCallAt = now();
  }

  async function callWithRetry(batch: ExportRow[]): Promise<CallResult> {
    for (let attempt = 1; ; attempt++) {
      await throttle();
      try {
        await target.upsert(batch);
        return { ok: true };
      } catch (e) {
        const error = classifyError(e);
        if (error.kind === "fatal") throw new FatalExportError(error.message);
        if (error.kind === "permanent" || attempt >= maxAttempts) return { ok: false, error };
        const backoff = baseDelayMs * 2 ** (attempt - 1) + random() * baseDelayMs;
        await sleep(error.rateLimited ? Math.max(backoff, target.rateLimitDelayMs) : backoff);
      }
    }
  }

  function fail(batch: ExportRow[], error: ClassifiedError) {
    const reason = error.kind === "transient" ? `${error.message} (gave up after ${maxAttempts} attempts)` : error.message;
    for (const row of batch) {
      progress.failures.push({ key: row.key, label: row.label, error: reason } satisfies ExportFailure);
    }
    progress.failed += batch.length;
  }

  try {
    for (let i = 0; i < rows.length; i += target.maxBatchSize) {
      const batch = rows.slice(i, i + target.maxBatchSize);
      const result = await callWithRetry(batch);

      if (result.ok) {
        progress.exported += batch.length;
      } else if (result.error.kind === "permanent" && batch.length > 1) {
        // isolate the bad record(s): retry each row on its own
        for (const row of batch) {
          const single = await callWithRetry([row]);
          if (single.ok) progress.exported += 1;
          else fail([row], single.error);
        }
      } else {
        fail(batch, result.error);
      }

      await opts.onProgress?.({ ...progress, failures: [...progress.failures] });
    }
  } catch (e) {
    if (!(e instanceof FatalExportError)) throw e;
    progress.failed = progress.total - progress.exported;
    return { ...progress, status: "failed", error: e.message };
  }

  const status = progress.failed === 0 ? "succeeded" : "completed_with_errors";
  return { ...progress, status };
}
