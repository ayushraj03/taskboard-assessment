import { describe, it, expect, beforeEach } from "vitest";
import * as commentsRoute from "@/app/api/tasks/[id]/comments/route";
import { prisma } from "@/lib/prisma";
import { resetDb, createFixture, authedRequest, params } from "./fixtures";

const { GET, POST } = commentsRoute;

type Fixture = Awaited<ReturnType<typeof createFixture>>;
let fx: Fixture;
let taskId: string;

beforeEach(async () => {
  await resetDb();
  fx = await createFixture();
  taskId = fx.launchTasks[0].id;
});

async function list(token: string | null, id = taskId) {
  const res = await GET(authedRequest(`/api/tasks/${id}/comments`, token), params({ id }));
  return { status: res.status, body: await res.json() };
}

async function post(token: string | null, payload: unknown, id = taskId) {
  const res = await POST(
    authedRequest(`/api/tasks/${id}/comments`, token, { method: "POST", body: payload }),
    params({ id }),
  );
  return { status: res.status, body: await res.json() };
}

function seedComment(authorId: string, body: string, createdAt: Date, id = taskId, projectId = fx.launch.id) {
  return prisma.taskComment.create({ data: { taskId: id, projectId, authorId, body, createdAt } });
}

describe("GET /api/tasks/:id/comments", () => {
  it.each(["admin", "member", "viewer"] as const)("lets a project %s read the thread", async (role) => {
    await seedComment(fx.member.id, "hello", new Date());
    const { status, body } = await list(fx[role].token);
    expect(status).toBe(200);
    expect(body.comments).toHaveLength(1);
  });

  it("lists comments oldest first regardless of insertion order", async () => {
    await seedComment(fx.member.id, "third", new Date("2026-01-03T00:00:00Z"));
    await seedComment(fx.admin.id, "first", new Date("2026-01-01T00:00:00Z"));
    await seedComment(fx.member.id, "second", new Date("2026-01-02T00:00:00Z"));

    const { body } = await list(fx.viewer.token);
    expect(body.comments.map((c: { body: string }) => c.body)).toEqual(["first", "second", "third"]);
  });

  it("returns author, body and timestamp — and never the author's email or password hash", async () => {
    await seedComment(fx.member.id, "looks good", new Date("2026-01-01T10:00:00Z"));
    const { body } = await list(fx.viewer.token);
    expect(body.comments[0]).toEqual({
      id: expect.any(String),
      taskId,
      body: "looks good",
      createdAt: "2026-01-01T10:00:00.000Z",
      author: { id: fx.member.id, name: "member" },
    });
  });

  it("only returns comments for the requested task", async () => {
    await seedComment(fx.member.id, "on task 0", new Date());
    await seedComment(fx.member.id, "on task 1", new Date(), fx.launchTasks[1].id);
    const { body } = await list(fx.member.token);
    expect(body.comments.map((c: { body: string }) => c.body)).toEqual(["on task 0"]);
  });

  it("rejects non-members", async () => {
    expect((await list(fx.outsider.token)).status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await list(null)).status).toBe(401);
  });

  it("returns 404 for an unknown task", async () => {
    expect((await list(fx.member.token, "does-not-exist")).status).toBe(404);
  });
});

describe("POST /api/tasks/:id/comments", () => {
  it.each(["admin", "member"] as const)("lets a project %s post", async (role) => {
    const { status, body } = await post(fx[role].token, { body: "  shipping friday  " });
    expect(status).toBe(201);
    expect(body.comment).toMatchObject({
      taskId,
      body: "shipping friday",
      author: { id: fx[role].id, name: role },
    });

    const stored = await prisma.taskComment.findUniqueOrThrow({ where: { id: body.comment.id } });
    expect(stored.projectId).toBe(fx.launch.id);
    expect(stored.authorId).toBe(fx[role].id);
  });

  it("forbids viewers from posting and stores nothing", async () => {
    const { status, body } = await post(fx.viewer.token, { body: "can I post?" });
    expect(status).toBe(403);
    expect(body.error).toMatch(/viewers/);
    expect(await prisma.taskComment.count()).toBe(0);
  });

  it("forbids non-members from posting and stores nothing", async () => {
    const { status } = await post(fx.outsider.token, { body: "drive-by comment" });
    expect(status).toBe(403);
    expect(await prisma.taskComment.count()).toBe(0);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await post(null, { body: "hi" })).status).toBe(401);
  });

  it("returns 404 for an unknown task", async () => {
    expect((await post(fx.member.token, { body: "hi" }, "does-not-exist")).status).toBe(404);
  });

  it.each([
    ["missing body", {}],
    ["empty body", { body: "" }],
    ["whitespace-only body", { body: "   \n  " }],
    ["over 5000 characters", { body: "x".repeat(5001) }],
    ["non-string body", { body: 42 }],
  ])("rejects %s", async (_label, payload) => {
    const { status } = await post(fx.member.token, payload);
    expect(status).toBe(400);
    expect(await prisma.taskComment.count()).toBe(0);
  });

  it("ignores client-supplied author, timestamp and id", async () => {
    const before = Date.now();
    const { status, body } = await post(fx.member.token, {
      body: "trust me",
      authorId: fx.admin.id,
      createdAt: "2001-01-01T00:00:00Z",
      id: "forged-id",
    });
    expect(status).toBe(201);
    expect(body.comment.id).not.toBe("forged-id");
    expect(body.comment.author.id).toBe(fx.member.id);
    expect(new Date(body.comment.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("posted comments appear in the thread in order", async () => {
    await post(fx.member.token, { body: "one" });
    await post(fx.admin.token, { body: "two" });
    const { body } = await list(fx.viewer.token);
    expect(body.comments.map((c: { body: string; author: { name: string } }) => `${c.author.name}: ${c.body}`)).toEqual([
      "member: one",
      "admin: two",
    ]);
  });
});

describe("append-only", () => {
  it("exposes no update or delete handlers on the comments route (Next.js answers 405)", () => {
    expect(Object.keys(commentsRoute).sort()).toEqual(["GET", "POST"]);
  });

  it("rejects UPDATE at the database level", async () => {
    const c = await seedComment(fx.member.id, "original", new Date());
    await expect(
      prisma.taskComment.update({ where: { id: c.id }, data: { body: "rewritten history" } }),
    ).rejects.toThrow(/append-only/);
    expect((await prisma.taskComment.findUniqueOrThrow({ where: { id: c.id } })).body).toBe("original");
  });

  it("rejects DELETE at the database level", async () => {
    const c = await seedComment(fx.member.id, "keep me", new Date());
    await expect(prisma.taskComment.delete({ where: { id: c.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.taskComment.deleteMany({})).rejects.toThrow(/append-only/);
    expect(await prisma.taskComment.count()).toBe(1);
  });

  it("rejects a comment whose projectId does not match its task's project", async () => {
    await expect(
      seedComment(fx.outsider.id, "smuggled", new Date(), taskId, fx.secret.id),
    ).rejects.toThrow();
  });
});
