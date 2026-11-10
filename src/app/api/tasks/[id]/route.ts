import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  conflict,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { isForeignKeyViolation } from "@/lib/prisma";
import { updateTaskSchema } from "@/schemas/task";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return notFound("task not found");

  const task = await prisma.task.update({
    where: { id },
    data: parsed.data,
    include: {
      assignee: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ task });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return notFound("task not found");

  const membership = await getProjectMembership(user.id, existing.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot delete tasks");
  }

  // comments are an append-only audit trail; the FK is ON DELETE RESTRICT, so
  // check up front for a clear error and treat a racing FK violation the same way
  const COMMENTS_CONFLICT = "this task has comments, which are part of the audit trail, so it cannot be deleted";
  if (await prisma.taskComment.count({ where: { taskId: id } })) return conflict(COMMENTS_CONFLICT);

  try {
    await prisma.task.delete({ where: { id } });
  } catch (e) {
    if (isForeignKeyViolation(e)) return conflict(COMMENTS_CONFLICT);
    throw e;
  }
  return NextResponse.json({ ok: true });
}
