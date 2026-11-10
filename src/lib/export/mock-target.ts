import { AirtableMockClient } from "@/lib/airtable-mock";
import type { ExportTarget } from "./types";

/**
 * ExportTarget backed by the provided Airtable test double. The mock supports
 * upsert-by-id natively, so each row is created with `id = row.key`. No
 * throttling or rate-limit wait: tests should run instantly.
 */
export function createMockTarget(client = new AirtableMockClient()): ExportTarget & { client: AirtableMockClient } {
  return {
    name: "airtable-mock",
    client,
    maxBatchSize: 10,
    minIntervalMs: 0,
    rateLimitDelayMs: 0,
    async upsert(rows) {
      for (const row of rows) {
        await client.create({ id: row.key, fields: row.fields });
      }
    },
  };
}
