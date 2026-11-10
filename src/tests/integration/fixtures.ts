import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/jwt";

// bcrypt hash of "password123" — fixtures never log in through the API, so any valid hash works
const PASSWORD_HASH = "$2a$10$vyZV8v8sGvEnz/x1/oO9U.e8jv0IbsAM7lJyldMxc7Z09TYXXO6DS";

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    // TRUNCATE bypasses the task_comments append-only row trigger, which is what we want for test resets
    `TRUNCATE TABLE "task_comments", "tasks", "memberships", "projects", "users" RESTART IDENTITY CASCADE`,
  );
}

async function createUser(name: string) {
  const user = await prisma.user.create({
    data: { email: `${name}@test.dev`, name, passwordHash: PASSWORD_HASH },
  });
  return { ...user, token: signToken({ userId: user.id, email: user.email }) };
}

/**
 * Two projects:
 *  - "Launch": admin / member / viewer, with a handful of tasks
 *  - "Secret": owned by `outsider`, who has no access to Launch (and vice versa)
 */
export async function createFixture() {
  const [admin, member, viewer, outsider] = await Promise.all([
    createUser("admin"),
    createUser("member"),
    createUser("viewer"),
    createUser("outsider"),
  ]);

  const launch = await prisma.project.create({
    data: {
      name: "Launch",
      ownerId: admin.id,
      memberships: {
        create: [
          { userId: admin.id, role: "admin" },
          { userId: member.id, role: "member" },
          { userId: viewer.id, role: "viewer" },
        ],
      },
    },
  });

  const secret = await prisma.project.create({
    data: {
      name: "Secret",
      ownerId: outsider.id,
      memberships: { create: [{ userId: outsider.id, role: "admin" }] },
    },
  });

  const launchTasks = await Promise.all(
    [
      { title: "Draft press release", description: "Coordinate with PR agency", status: "todo" as const },
      { title: "Record demo video", description: "Show the new PRESS kit", status: "in_progress" as const },
      { title: "O'Brien's launch checklist", description: null, status: "review" as const },
      { title: "Update pricing page", description: "50% off for early adopters", status: "done" as const },
    ].map((t, i) =>
      prisma.task.create({
        data: { ...t, projectId: launch.id, createdById: admin.id, assigneeId: member.id, position: i },
      }),
    ),
  );

  const secretTask = await prisma.task.create({
    data: {
      title: "Acquisition target shortlist",
      description: "Confidential: press embargo until close",
      projectId: secret.id,
      createdById: outsider.id,
      position: 0,
    },
  });

  return { admin, member, viewer, outsider, launch, secret, launchTasks, secretTask };
}

export function authedRequest(
  url: string,
  token: string | null,
  init: { method?: string; body?: unknown } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export function params<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}
