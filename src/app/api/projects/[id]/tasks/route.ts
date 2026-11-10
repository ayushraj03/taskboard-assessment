import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  badRequest,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { createTaskSchema, taskSearchSchema } from "@/schemas/task";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;
  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");

  const parsedQuery = taskSearchSchema.safeParse(req.nextUrl.searchParams.get("q") ?? undefined);
  if (!parsedQuery.success) return badRequest("invalid search query", parsedQuery.error.flatten());
  // prisma passes `contains` as a bound parameter but does not escape LIKE wildcards
  const q = parsedQuery.data?.replace(/[\\%_]/g, "\\$&");

  // search goes through the same parameterized query as the plain listing — never raw SQL
  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      ...(q && {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      }),
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ status: "asc" }, { position: "asc" }],
  });

  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;
  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot create tasks");
  }

  const body = await req.json().catch(() => null);
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const status = parsed.data.status ?? "todo";

  // place new task at the end of its column
  const last = await prisma.task.findFirst({
    where: { projectId, status },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const task = await prisma.task.create({
    data: {
      projectId,
      title: parsed.data.title,
      description: parsed.data.description,
      status,
      assigneeId: parsed.data.assigneeId ?? null,
      createdById: user.id,
      position: (last?.position ?? -1) + 1,
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
