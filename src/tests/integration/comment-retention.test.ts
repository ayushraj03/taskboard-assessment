import { describe, it, expect, beforeEach } from "vitest";
import { DELETE as deleteTask } from "@/app/api/tasks/[id]/route";
import { DELETE as deleteProject } from "@/app/api/projects/[id]/route";
import { prisma } from "@/lib/prisma";
import { resetDb, createFixture, authedRequest, params } from "./fixtures";

// Comments are an audit trail, so deleting the task or project they hang off
// must not destroy them.

type Fixture = Awaited<ReturnType<typeof createFixture>>;
let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await createFixture();
});

function addComment(taskId: string) {
  return prisma.taskComment.create({
    data: { taskId, projectId: fx.launch.id, authorId: fx.member.id, body: "audit me" },
  });
}

describe("DELETE /api/tasks/:id with comments", () => {
  it("refuses with 409 and keeps both the task and its comments", async () => {
    const task = fx.launchTasks[0];
    await addComment(task.id);

    const res = await deleteTask(
      authedRequest(`/api/tasks/${task.id}`, fx.admin.token, { method: "DELETE" }),
      params({ id: task.id }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/comments/);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
    expect(await prisma.taskComment.count({ where: { taskId: task.id } })).toBe(1);
  });

  it("still deletes tasks that have no comments", async () => {
    const task = fx.launchTasks[1];
    await addComment(fx.launchTasks[0].id);

    const res = await deleteTask(
      authedRequest(`/api/tasks/${task.id}`, fx.member.token, { method: "DELETE" }),
      params({ id: task.id }),
    );

    expect(res.status).toBe(200);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
  });

  it("checks permissions before revealing the conflict", async () => {
    const task = fx.launchTasks[0];
    await addComment(task.id);

    const res = await deleteTask(
      authedRequest(`/api/tasks/${task.id}`, fx.viewer.token, { method: "DELETE" }),
      params({ id: task.id }),
    );
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/projects/:id with comments", () => {
  it("refuses with 409 and keeps the project, tasks and comments", async () => {
    await addComment(fx.launchTasks[2].id);

    const res = await deleteProject(
      authedRequest(`/api/projects/${fx.launch.id}`, fx.admin.token, { method: "DELETE" }),
      params({ id: fx.launch.id }),
    );

    expect(res.status).toBe(409);
    expect(await prisma.project.findUnique({ where: { id: fx.launch.id } })).not.toBeNull();
    expect(await prisma.task.count({ where: { projectId: fx.launch.id } })).toBe(4);
    expect(await prisma.taskComment.count()).toBe(1);
  });

  it("still deletes projects that have no comments", async () => {
    const res = await deleteProject(
      authedRequest(`/api/projects/${fx.secret.id}`, fx.outsider.token, { method: "DELETE" }),
      params({ id: fx.secret.id }),
    );
    expect(res.status).toBe(200);
    expect(await prisma.project.findUnique({ where: { id: fx.secret.id } })).toBeNull();
  });
});
