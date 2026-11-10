export type ExportFields = Record<string, unknown>;

/** One record to push. `key` is our stable id (the task id) used for upserts. */
export type ExportRow = {
  key: string;
  /** human-readable label for failure reports (the task title) */
  label: string;
  fields: ExportFields;
};

/**
 * A destination for exported rows. Implementations must make `upsert`
 * idempotent on `row.key` so an export can safely be re-run, and must throw
 * on failure (the error is classified by `classifyError`).
 */
export interface ExportTarget {
  readonly name: string;
  /** max rows per upsert call */
  readonly maxBatchSize: number;
  /** min spacing between calls, to stay under the target's rate limit */
  readonly minIntervalMs: number;
  /** how long to back off after a rate-limit response */
  readonly rateLimitDelayMs: number;
  upsert(rows: ExportRow[]): Promise<void>;
}

export type ExportFailure = { key: string; label: string; error: string };

export type ExportProgress = {
  total: number;
  exported: number;
  failed: number;
  failures: ExportFailure[];
};

export type ExportOutcome = ExportProgress & {
  status: "succeeded" | "completed_with_errors" | "failed";
  /** set when the run was aborted by a fatal (configuration-level) error */
  error?: string;
};
