import { describe, it, expect, vi, afterEach } from "vitest";
import { runExport } from "@/lib/export/run-export";
import { classifyError } from "@/lib/export/classify";
import { createMockTarget } from "@/lib/export/mock-target";
import { toExportRow, MERGE_FIELD } from "@/lib/export/task-rows";
import { AirtableError as MockAirtableError } from "@/lib/airtable-mock";
import type { ExportRow, ExportTarget } from "@/lib/export/types";

// mirrors the shape of the real `airtable` package's AirtableError
function airtableError(error: string, statusCode: number) {
  return Object.assign(new Error(`${error} message`), { error, statusCode });
}

function rows(n: number): ExportRow[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `task_${i}`,
    label: `Task ${i}`,
    fields: { [MERGE_FIELD]: `task_${i}`, Title: `Task ${i}` },
  }));
}

/** target whose behaviour per call is scripted; records every call */
function scriptedTarget(behave: (batch: ExportRow[], callNo: number) => unknown) {
  const calls: string[][] = [];
  const target: ExportTarget = {
    name: "scripted",
    maxBatchSize: 10,
    minIntervalMs: 0,
    rateLimitDelayMs: 30_000,
    async upsert(batch) {
      calls.push(batch.map((r) => r.key));
      const err = behave(batch, calls.length);
      if (err) throw err;
    },
  };
  return { target, calls };
}

const instant = { sleep: async () => {}, random: () => 0 };

afterEach(() => vi.restoreAllMocks());

describe("classifyError", () => {
  it.each([
    ["429 rate limit", airtableError("TOO_MANY_REQUESTS", 429), "transient"],
    ["500", airtableError("SERVER_ERROR", 500), "transient"],
    ["502", airtableError("BAD_GATEWAY", 502), "transient"],
    ["503", airtableError("SERVICE_UNAVAILABLE", 503), "transient"],
    ["network: fetch failed", Object.assign(new TypeError("fetch failed"), {}), "transient"],
    ["network: ECONNRESET", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }), "transient"],
    ["timeout: AbortError", Object.assign(new Error("aborted"), { name: "AbortError" }), "transient"],
    ["mock rate-limit", new MockAirtableError("x", "rate-limit", 429), "transient"],
    ["mock server-error", new MockAirtableError("x", "server-error", 500), "transient"],
    ["mock network", new MockAirtableError("x", "network", 0), "transient"],
    ["422 invalid value", airtableError("INVALID_VALUE_FOR_COLUMN", 422), "permanent"],
    ["400 invalid request", airtableError("INVALID_REQUEST_UNKNOWN", 400), "permanent"],
    ["413 too large", airtableError("REQUEST_TOO_LARGE", 413), "permanent"],
    ["401 bad token", airtableError("AUTHENTICATION_REQUIRED", 401), "fatal"],
    ["403 no access", airtableError("INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND", 403), "fatal"],
    ["404 base/table missing", airtableError("NOT_FOUND", 404), "fatal"],
    ["422 unknown field", airtableError("UNKNOWN_FIELD_NAME", 422), "fatal"],
    ["our own bug", new RangeError("oops"), "permanent"],
  ])("%s → %s", (_label, error, kind) => {
    expect(classifyError(error).kind).toBe(kind);
  });

  it("flags rate limits so the engine can wait longer", () => {
    expect(classifyError(airtableError("TOO_MANY_REQUESTS", 429)).rateLimited).toBe(true);
    expect(classifyError(airtableError("SERVER_ERROR", 500)).rateLimited).toBe(false);
  });
});

describe("toExportRow", () => {
  const task = {
    id: "t_1",
    title: "Draft press release",
    description: null,
    status: "in_progress" as const,
    position: 3,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    assignee: { name: "Kavya Reddy", email: "kavya@example.com" },
  };

  it("maps a task to the Airtable columns, keyed on the task id", () => {
    const row = toExportRow(task, "Q3 Launch", new Date("2026-02-01T00:00:00Z"));
    expect(row.key).toBe("t_1");
    expect(row.fields).toEqual({
      "TaskBoard ID": "t_1",
      Title: "Draft press release",
      Description: "",
      Status: "In progress",
      Assignee: "Kavya Reddy",
      Project: "Q3 Launch",
      Position: 3,
      "Created At": "2026-01-01T00:00:00.000Z",
      "Updated At": "2026-01-02T00:00:00.000Z",
      "Last Exported At": "2026-02-01T00:00:00.000Z",
    });
  });

  it("never exports the assignee's email", () => {
    const row = toExportRow(task, "Q3 Launch", new Date());
    expect(JSON.stringify(row)).not.toContain("kavya@example.com");
  });

  it("exports an empty assignee for unassigned tasks", () => {
    expect(toExportRow({ ...task, assignee: null }, "P", new Date()).fields.Assignee).toBe("");
  });
});

describe("runExport", () => {
  it("exports everything in batches of the target's max size", async () => {
    const { target, calls } = scriptedTarget(() => undefined);
    const outcome = await runExport(rows(25), target, instant);
    expect(calls.map((c) => c.length)).toEqual([10, 10, 5]);
    expect(outcome).toMatchObject({ status: "succeeded", total: 25, exported: 25, failed: 0 });
  });

  it("is idempotent: re-running updates the same records instead of duplicating", async () => {
    const target = createMockTarget();
    const data = rows(12);

    await runExport(data, target, instant);
    expect(target.client.__getRecordCount()).toBe(12);

    data[0].fields.Title = "Renamed";
    const second = await runExport(data, target, instant);
    expect(second.status).toBe("succeeded");
    expect(target.client.__getRecordCount()).toBe(12);
    expect(target.client.__getRecords().find((r) => r.id === "task_0")?.fields.Title).toBe("Renamed");
  });

  it("retries transient failures and succeeds", async () => {
    const { target, calls } = scriptedTarget((_b, n) =>
      n === 1 ? airtableError("SERVER_ERROR", 500) : n === 2 ? new TypeError("fetch failed") : undefined,
    );
    const outcome = await runExport(rows(3), target, instant);
    expect(calls).toHaveLength(3);
    expect(outcome).toMatchObject({ status: "succeeded", exported: 3 });
  });

  it("backs off exponentially, and for at least the rate-limit delay after a 429", async () => {
    const sleeps: number[] = [];
    const { target } = scriptedTarget((_b, n) =>
      n === 1 ? airtableError("SERVER_ERROR", 500) : n === 2 ? airtableError("TOO_MANY_REQUESTS", 429) : undefined,
    );
    await runExport(rows(1), target, { sleep: async (ms) => void sleeps.push(ms), random: () => 0, baseDelayMs: 100 });
    expect(sleeps).toEqual([100, 30_000]);
  });

  it("gives up on a batch after maxAttempts, records it, and carries on with the rest", async () => {
    // first batch (task_0..9) always 503s; second batch is fine
    const { target, calls } = scriptedTarget((batch) =>
      batch[0].key === "task_0" ? airtableError("SERVICE_UNAVAILABLE", 503) : undefined,
    );
    const outcome = await runExport(rows(15), target, { ...instant, maxAttempts: 4 });

    expect(calls.filter((c) => c[0] === "task_0")).toHaveLength(4);
    expect(outcome).toMatchObject({ status: "completed_with_errors", exported: 5, failed: 10 });
    expect(outcome.failures[0]).toEqual({
      key: "task_0",
      label: "Task 0",
      error: expect.stringContaining("gave up after 4 attempts"),
    });
  });

  it("does not retry permanent failures, and isolates the bad record from its batch", async () => {
    const { target, calls } = scriptedTarget((batch) =>
      batch.some((r) => r.key === "task_4") ? airtableError("INVALID_VALUE_FOR_COLUMN", 422) : undefined,
    );
    const outcome = await runExport(rows(10), target, instant);

    // 1 batch call + 10 single-row calls; the bad row is tried once on its own, never retried
    expect(calls).toHaveLength(11);
    expect(calls.filter((c) => c.includes("task_4"))).toHaveLength(2);
    expect(outcome).toMatchObject({ status: "completed_with_errors", exported: 9, failed: 1 });
    expect(outcome.failures).toEqual([
      { key: "task_4", label: "Task 4", error: expect.stringContaining("INVALID_VALUE_FOR_COLUMN") },
    ]);
  });

  it.each([
    ["bad token (401)", airtableError("AUTHENTICATION_REQUIRED", 401)],
    ["missing table (404)", airtableError("NOT_FOUND", 404)],
    ["missing column (422 UNKNOWN_FIELD_NAME)", airtableError("UNKNOWN_FIELD_NAME", 422)],
  ])("aborts the whole run on a fatal error: %s", async (_label, error) => {
    const { target, calls } = scriptedTarget(() => error);
    const outcome = await runExport(rows(30), target, instant);

    expect(calls).toHaveLength(1);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain(error.error);
    expect(outcome).toMatchObject({ exported: 0, failed: 30 });
  });

  it("throttles calls to the target's minimum interval", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const { target } = scriptedTarget(() => {
      clock += 50; // each call takes 50ms
    });
    await runExport(rows(30), { ...target, minIntervalMs: 200 }, {
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    // 3 calls: the 2nd and 3rd each wait out the rest of the 200ms window
    expect(sleeps).toEqual([150, 150]);
  });

  it("reports progress after every batch", async () => {
    const { target } = scriptedTarget(() => undefined);
    const seen: number[] = [];
    await runExport(rows(25), target, { ...instant, onProgress: (p) => void seen.push(p.exported) });
    expect(seen).toEqual([10, 20, 25]);
  });

  it("survives the test double's random transient failures without losing or duplicating records", async () => {
    // deterministic PRNG so the mock's Math.random-driven failures are repeatable
    let seed = 42;
    vi.spyOn(Math, "random").mockImplementation(() => ((seed = (seed * 16807) % 2147483647) / 2147483647));

    const target = createMockTarget();
    target.client.__setFailureRate(0.3, "server-error");
    const outcome = await runExport(rows(40), target, { ...instant, maxAttempts: 10 });

    expect(outcome.exported + outcome.failed).toBe(40);
    expect(outcome.exported).toBeGreaterThan(0);
    const keys = target.client.__getRecords().map((r) => r.id);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of outcome.failures) expect(f.error).toMatch(/gave up/);
  });
});
