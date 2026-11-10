/**
 * Decides how the export engine reacts to an error from an export target.
 *
 *  - transient: worth retrying (rate limit, 5xx, network blip)
 *  - permanent: this record/batch will never succeed as-is; don't retry, but
 *               other records may still go through (e.g. invalid field value)
 *  - fatal:     configuration problem that will fail every record (bad token,
 *               no access, missing base/table/field); abort the whole run
 *
 * Works with the real `airtable` package's AirtableError ({ error, message,
 * statusCode }), the test double's AirtableError ({ type, statusCode }), and
 * raw fetch/network errors (which carry no status code).
 */
export type ErrorKind = "transient" | "permanent" | "fatal";

export type ClassifiedError = {
  kind: ErrorKind;
  rateLimited: boolean;
  message: string;
};

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const FATAL_STATUS = new Set([401, 403, 404]);
// 422s that mean "the table doesn't look like we expect", not "this record is bad"
const FATAL_AIRTABLE_CODES = new Set([
  "UNKNOWN_FIELD_NAME",
  "INVALID_PERMISSIONS",
  "INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND",
  "AUTHENTICATION_REQUIRED",
  "NOT_AUTHORIZED",
  "NOT_FOUND",
  "TABLE_NOT_FOUND",
  "INVALID_MERGE_FIELD",
]);
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

type ErrorLike = {
  statusCode?: unknown;
  error?: unknown;
  type?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
  cause?: { code?: unknown };
};

export function classifyError(e: unknown): ClassifiedError {
  const err = (typeof e === "object" && e !== null ? e : {}) as ErrorLike;
  const status = typeof err.statusCode === "number" ? err.statusCode : undefined;
  const code = typeof err.error === "string" ? err.error : undefined;
  const message = describe(err, e);

  if (status === 429 || err.type === "rate-limit" || code === "TOO_MANY_REQUESTS") {
    return { kind: "transient", rateLimited: true, message };
  }
  if (code && FATAL_AIRTABLE_CODES.has(code)) return { kind: "fatal", rateLimited: false, message };
  if (status !== undefined && FATAL_STATUS.has(status)) return { kind: "fatal", rateLimited: false, message };
  if (status !== undefined && TRANSIENT_STATUS.has(status)) return { kind: "transient", rateLimited: false, message };
  if (status !== undefined && status >= 400 && status < 500) return { kind: "permanent", rateLimited: false, message };
  if (status !== undefined && status >= 500) return { kind: "transient", rateLimited: false, message };

  // no HTTP status: network-level failure, or a bug on our side
  if (err.type === "network" || err.type === "server-error") return { kind: "transient", rateLimited: false, message };
  if (isNetworkError(err)) return { kind: "transient", rateLimited: false, message };
  return { kind: "permanent", rateLimited: false, message };
}

function isNetworkError(err: ErrorLike): boolean {
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  const code = typeof err.code === "string" ? err.code : typeof err.cause?.code === "string" ? err.cause.code : "";
  if (TRANSIENT_NETWORK_CODES.has(code)) return true;
  return err.name === "TypeError" && err.message === "fetch failed";
}

function describe(err: ErrorLike, original: unknown): string {
  const parts = [
    typeof err.error === "string" ? err.error : undefined,
    typeof err.message === "string" ? err.message : undefined,
    typeof err.statusCode === "number" && err.statusCode > 0 ? `(HTTP ${err.statusCode})` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(": ").replace(": (", " (") : String(original);
}
