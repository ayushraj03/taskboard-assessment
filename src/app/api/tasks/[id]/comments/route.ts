import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  getTaskAccess,
  canEditTasks,
} from "@/lib/auth";
import { createCommentSchema } from "@/schemas/comment";

// Comments are append-only: this route deliberately exports only GET and POST,
// so PATCH/PUT/DELETE get a 405 from Next.js. The DB trigger backs this up.

type Params = { params: Promise<{ id: string }> };

const commentSelect = {
  id: true,
  taskId: true,
  body: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
} as const;

export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: taskId } = await params;
  const { task, role } = await getTaskAccess(user.id, taskId);
  if (!task) return notFound("task not found");
  if (!role) return forbidden("you are not a member of this project");

  const comments = await prisma.taskComment.findMany({
    where: { taskId },
    select: commentSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({ comments });
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: taskId } = await params;
  const { task, role } = await getTaskAccess(user.id, taskId);
  if (!task) return notFound("task not found");
  if (!role) return forbidden("you are not a member of this project");
  if (!canEditTasks(role)) return forbidden("viewers can read comments but not post");

  const body = await req.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const comment = await prisma.taskComment.create({
    data: {
      taskId: task.id,
      projectId: task.projectId,
      authorId: user.id,
      body: parsed.data.body,
    },
    select: commentSelect,
  });

  return NextResponse.json({ comment }, { status: 201 });
}
