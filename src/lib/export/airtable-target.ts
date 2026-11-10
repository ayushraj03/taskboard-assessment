import Airtable, { type FieldSet, type RecordData } from "airtable";
import type { ExportTarget } from "./types";
import { MERGE_FIELD } from "./task-rows";

export type AirtableConfig = { apiKey: string; baseId: string; tableName: string };

export function getAirtableConfig(): AirtableConfig | null {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME || "Tasks";
  if (!apiKey || !baseId) return null;
  return { apiKey, baseId, tableName };
}

/**
 * Real Airtable target using the official `airtable` package.
 *
 * Idempotency: Airtable assigns its own record ids, so we can't reuse ours
 * (unlike the test double). Instead every call is an upsert merged on the
 * "TaskBoard ID" field — re-running updates existing rows, never duplicates.
 */
export function createAirtableTarget(config: AirtableConfig): ExportTarget {
  const table = new Airtable({
    apiKey: config.apiKey,
    // the package retries 429s forever with no cap and never retries 5xx or
    // network errors; we retry everything ourselves with a bounded policy
    noRetryIfRateLimited: true,
    requestTimeout: 30_000,
  }).base(config.baseId)(config.tableName);

  return {
    name: "airtable",
    maxBatchSize: 10, // Airtable API limit per request
    minIntervalMs: 220, // Airtable allows 5 requests/second per base
    rateLimitDelayMs: 30_000, // Airtable asks clients to wait 30s after a 429
    async upsert(rows) {
      // upsert records carry no record id; the package's types require one
      const records = rows.map((r) => ({ fields: r.fields })) as unknown as RecordData<Partial<FieldSet>>[];
      await table.update(records, {
        performUpsert: { fieldsToMergeOn: [MERGE_FIELD] },
        typecast: true,
      } as never);
    },
  };
}
