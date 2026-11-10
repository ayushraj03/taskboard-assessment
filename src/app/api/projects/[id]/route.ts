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
  canEditProject,
} from "@/lib/auth";
import { isForeignKeyViolation } from "@/lib/prisma";
import { updateProjectSchema } from "@/schemas/project";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;

  const membership = await getProjectMembership(user.id, id);
  if (!membership) return forbidden("you are not a member of this project");

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      owner: true,
      memberships: {
        include: { user: true },
      },
      tasks: {
        include: {
          assignee: true,
          createdBy: true,
        },
        orderBy: [{ status: "asc" }, { position: "asc" }],
      },
    },
  });

  if (!project) return notFound("project not found");

  return NextResponse.json({ project });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;
  const membership = await getProjectMembership(user.id, id);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditProject(membership.role)) {
    return forbidden("only project admins can edit project settings");
  }

  const body = await req.json().catch(() => null);
  const parsed = updateProjectSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const project = await prisma.project.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json({ project });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;
  const membership = await getProjectMembership(user.id, id);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditProject(membership.role)) {
    return forbidden("only project admins can delete the project");
  }

  // deleting the project would cascade to its tasks, whose comments are an
  // append-only audit trail (ON DELETE RESTRICT)
  const COMMENTS_CONFLICT = "this project has task comments, which are part of the audit trail, so it cannot be deleted";
  if (await prisma.taskComment.count({ where: { projectId: id } })) return conflict(COMMENTS_CONFLICT);

  try {
    await prisma.project.delete({ where: { id } });
  } catch (e) {
    if (isForeignKeyViolation(e)) return conflict(COMMENTS_CONFLICT);
    throw e;
  }
  return NextResponse.json({ ok: true });
}
