import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runExport, type RunExportOptions } from "./run-export";
import { toExportRow } from "./task-rows";
import type { ExportFailure, ExportTarget } from "./types";

/** a "running" export older than this is assumed dead (e.g. server restart) */
export const STALE_RUN_MS = 15 * 60 * 1000;
/** cap stored failure details so one bad export can't bloat the row */
const MAX_STORED_FAILURES = 200;

export const exportRunSelect = {
  id: true,
  target: true,
  status: true,
  total: true,
  exported: true,
  failed: true,
  failures: true,
  error: true,
  startedAt: true,
  finishedAt: true,
  triggeredBy: { select: { id: true, name: true } },
} as const;

/**
 * Creates a new running ExportRun for the project, unless one is already in
 * progress. Serialized per project with a transaction-scoped advisory lock so
 * two simultaneous clicks can't both start an export.
 */
export async function startExportRun(projectId: string, userId: string, target: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`export:${projectId}`}))`;

    await tx.exportRun.updateMany({
      where: { projectId, status: "running", startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
      data: { status: "failed", error: "export never finished (server restarted?); marked as stale", finishedAt: new Date() },
    });

    const running = await tx.exportRun.findFirst({ where: { projectId, status: "running" }, select: exportRunSelect });
    if (running) return { run: running, conflict: true as const };

    const run = await tx.exportRun.create({
      data: { projectId, triggeredById: userId, target },
      select: exportRunSelect,
    });
    return { run, conflict: false as const };
  });
}

/**
 * Loads every task in the run's project, pushes them to `target`, and records
 * progress and the outcome on the ExportRun. Never throws.
 */
export async function executeExportRun(runId: string, target: ExportTarget, opts: RunExportOptions = {}) {
  const update = (data: Prisma.ExportRunUpdateInput) => prisma.exportRun.update({ where: { id: runId }, data });
  const storedFailures = (failures: ExportFailure[]) => failures.slice(0, MAX_STORED_FAILURES);

  try {
    const run = await prisma.exportRun.findUniqueOrThrow({
      where: { id: runId },
      select: { projectId: true, project: { select: { name: true } } },
    });

    const tasks = await prisma.task.findMany({
      where: { projectId: run.projectId },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        position: true,
        createdAt: true,
        updatedAt: true,
        assignee: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { position: "asc" }],
    });

    const exportedAt = new Date();
    const rows = tasks.map((t) => toExportRow(t, run.project.name, exportedAt));
    await update({ total: rows.length });

    const outcome = await runExport(rows, target, {
      ...opts,
      onProgress: async (p) => {
        await update({ exported: p.exported, failed: p.failed, failures: storedFailures(p.failures) });
      },
    });

    await update({
      status: outcome.status,
      exported: outcome.exported,
      failed: outcome.failed,
      failures: storedFailures(outcome.failures),
      error: outcome.error ?? null,
      finishedAt: new Date(),
    });
  } catch (e) {
    console.error(`[export ${runId}] unexpected error`, e);
    await update({
      status: "failed",
      error: `unexpected error: ${e instanceof Error ? e.message : String(e)}`,
      finishedAt: new Date(),
    }).catch(() => undefined);
  }
}
