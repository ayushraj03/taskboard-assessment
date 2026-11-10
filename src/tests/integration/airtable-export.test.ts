import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockTarget } from "@/lib/export/mock-target";
import type { ExportTarget } from "@/lib/export/types";

// run background work inline so tests can await it
const background: Promise<unknown>[] = [];
vi.mock("@/lib/background", () => ({
  runInBackground: (task: () => Promise<unknown>) => void background.push(task()),
}));

// swap the real Airtable target for the provided test double
let target: (ExportTarget & { client?: ReturnType<typeof createMockTarget>["client"] }) | null;
vi.mock("@/lib/export/target-factory", () => ({
  getExportTarget: () => target,
  getExportDestinationUrl: () => (target ? "https://airtable.com/appTEST" : null),
}));

const { GET, POST } = await import("@/app/api/projects/[id]/exports/airtable/route");
const { prisma } = await import("@/lib/prisma");
const { resetDb, createFixture, authedRequest, params } = await import("./fixtures");

type Fixture = Awaited<ReturnType<typeof createFixture>>;
let fx: Fixture;
let mock: ReturnType<typeof createMockTarget>;

beforeEach(async () => {
  await resetDb();
  fx = await createFixture();
  mock = createMockTarget();
  target = mock;
  background.length = 0;
});

async function startExport(token: string | null, projectId = fx.launch.id) {
  const res = await POST(
    authedRequest(`/api/projects/${projectId}/exports/airtable`, token, { method: "POST" }),
    params({ id: projectId }),
  );
  await Promise.all(background);
  return { status: res.status, body: await res.json() };
}

async function latest(token: string, projectId = fx.launch.id) {
  const res = await GET(authedRequest(`/api/projects/${projectId}/exports/airtable`, token), params({ id: projectId }));
  return { status: res.status, body: await res.json() };
}

describe("POST /api/projects/:id/exports/airtable", () => {
  it.each(["admin", "member"] as const)("lets a project %s export every task", async (role) => {
    const { status, body } = await startExport(fx[role].token);
    expect(status).toBe(202);
    expect(body.run).toMatchObject({ status: "running", triggeredBy: { id: fx[role].id } });

    const run = await prisma.exportRun.findUniqueOrThrow({ where: { id: body.run.id } });
    expect(run).toMatchObject({ status: "succeeded", total: 4, exported: 4, failed: 0 });
    expect(run.finishedAt).not.toBeNull();

    const titles = mock.client.__getRecords().map((r) => r.fields.Title).sort();
    expect(titles).toEqual(["Draft press release", "O'Brien's launch checklist", "Record demo video", "Update pricing page"]);
  });

  it("only exports the requested project's tasks", async () => {
    await startExport(fx.admin.token);
    const keys = mock.client.__getRecords().map((r) => r.id);
    expect(keys).not.toContain(fx.secretTask.id);
  });

  it.each([
    ["a viewer", "viewer", 403],
    ["a non-member", "outsider", 403],
  ] as const)("rejects %s and starts nothing", async (_label, who, code) => {
    const { status } = await startExport(fx[who].token);
    expect(status).toBe(code);
    expect(await prisma.exportRun.count()).toBe(0);
    expect(mock.client.__getRecordCount()).toBe(0);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await startExport(null)).status).toBe(401);
  });

  it("returns 503 when Airtable is not configured", async () => {
    target = null;
    const { status, body } = await startExport(fx.admin.token);
    expect(status).toBe(503);
    expect(body.error).toMatch(/not configured/);
    expect(await prisma.exportRun.count()).toBe(0);
  });

  it("is idempotent across runs: no duplicates, edits are updated in place", async () => {
    await startExport(fx.admin.token);
    expect(mock.client.__getRecordCount()).toBe(4);

    await prisma.task.update({ where: { id: fx.launchTasks[0].id }, data: { title: "Draft press release v2" } });
    const second = await startExport(fx.member.token);
    expect(second.status).toBe(202);

    expect(mock.client.__getRecordCount()).toBe(4);
    const row = mock.client.__getRecords().find((r) => r.id === fx.launchTasks[0].id);
    expect(row?.fields.Title).toBe("Draft press release v2");
    expect(await prisma.exportRun.count({ where: { status: "succeeded" } })).toBe(2);
  });

  it("refuses to start a second export while one is running", async () => {
    const running = await prisma.exportRun.create({
      data: { projectId: fx.launch.id, triggeredById: fx.admin.id, target: "airtable" },
    });
    const { status, body } = await startExport(fx.member.token);
    expect(status).toBe(409);
    expect(body.run.id).toBe(running.id);
    expect(await prisma.exportRun.count()).toBe(1);
  });

  it("serializes concurrent clicks so only one export starts", async () => {
    const results = await Promise.all([startExport(fx.admin.token), startExport(fx.member.token)]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
  });

  it("treats a long-stuck running export as stale and starts a fresh one", async () => {
    const stale = await prisma.exportRun.create({
      data: {
        projectId: fx.launch.id,
        triggeredById: fx.admin.id,
        target: "airtable",
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    const { status } = await startExport(fx.member.token);
    expect(status).toBe(202);
    expect(await prisma.exportRun.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/stale/),
    });
  });

  it("does not fail the whole export when one record is rejected", async () => {
    const bad = fx.launchTasks[2].id;
    target = {
      ...mock,
      async upsert(rows) {
        if (rows.some((r) => r.key === bad)) {
          throw Object.assign(new Error("bad value"), { error: "INVALID_VALUE_FOR_COLUMN", statusCode: 422 });
        }
        await mock.upsert(rows);
      },
    };

    const { body } = await startExport(fx.admin.token);
    const run = await prisma.exportRun.findUniqueOrThrow({ where: { id: body.run.id } });
    expect(run).toMatchObject({ status: "completed_with_errors", exported: 3, failed: 1 });
    expect(run.failures).toEqual([
      { key: bad, label: "O'Brien's launch checklist", error: expect.stringContaining("INVALID_VALUE_FOR_COLUMN") },
    ]);
    expect(mock.client.__getRecordCount()).toBe(3);
  });

  it("marks the run failed with a clear reason on a configuration error", async () => {
    target = {
      ...mock,
      async upsert() {
        throw Object.assign(new Error("Unknown field name: \"Status\""), { error: "UNKNOWN_FIELD_NAME", statusCode: 422 });
      },
    };
    const { body } = await startExport(fx.admin.token);
    const run = await prisma.exportRun.findUniqueOrThrow({ where: { id: body.run.id } });
    expect(run).toMatchObject({ status: "failed", exported: 0, failed: 4 });
    expect(run.error).toContain("UNKNOWN_FIELD_NAME");
  });
});

describe("GET /api/projects/:id/exports/airtable", () => {
  it("returns null before any export", async () => {
    const { status, body } = await latest(fx.member.token);
    expect(status).toBe(200);
    expect(body.run).toBeNull();
  });

  it("lets viewers see the latest export's status", async () => {
    await startExport(fx.admin.token);
    await startExport(fx.member.token);
    const { status, body } = await latest(fx.viewer.token);
    expect(status).toBe(200);
    expect(body.run).toMatchObject({ status: "succeeded", exported: 4, triggeredBy: { name: "member" } });
    expect(body.destinationUrl).toBe("https://airtable.com/appTEST");
  });

  it("rejects non-members", async () => {
    expect((await latest(fx.outsider.token)).status).toBe(403);
  });
});
