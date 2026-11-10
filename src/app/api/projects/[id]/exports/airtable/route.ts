import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { runInBackground } from "@/lib/background";
import { getExportTarget, getExportDestinationUrl } from "@/lib/export/target-factory";
import { executeExportRun, exportRunSelect, startExportRun } from "@/lib/export/service";

type Params = { params: Promise<{ id: string }> };

/** Latest export run for the project (any member, including viewers). */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;
  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");

  const run = await prisma.exportRun.findFirst({
    where: { projectId, target: "airtable" },
    orderBy: { startedAt: "desc" },
    select: exportRunSelect,
  });

  return NextResponse.json({ run, destinationUrl: getExportDestinationUrl() });
}

/**
 * Starts exporting every task in the project to Airtable (admins and members).
 * Returns 202 immediately; the export runs in the background and the client
 * polls GET for progress.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;
  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) return forbidden("only project admins and members can export");

  const target = getExportTarget();
  if (!target) {
    return NextResponse.json({ error: "Airtable export is not configured on this server" }, { status: 503 });
  }

  const { run, conflict } = await startExportRun(projectId, user.id, "airtable");
  if (conflict) {
    return NextResponse.json({ error: "an export for this project is already running", run }, { status: 409 });
  }

  runInBackground(() => executeExportRun(run.id, target));
  return NextResponse.json({ run }, { status: 202 });
}
