import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/projects/[id]/tasks/route";
import { resetDb, createFixture, authedRequest, params } from "./fixtures";

type Fixture = Awaited<ReturnType<typeof createFixture>>;
let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await createFixture();
});

async function search(q: string, token = fx.viewer.token, projectId = fx.launch.id) {
  const url = `/api/projects/${projectId}/tasks?${new URLSearchParams({ q })}`;
  const res = await GET(authedRequest(url, token), params({ id: projectId }));
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

describe("GET /api/projects/:id/tasks?q= — search", () => {
  it("matches title and description case-insensitively, scoped to the project", async () => {
    const { status, body } = await search("press");
    expect(status).toBe(200);
    // "Draft press release" (title) + "Record demo video" (description: "PRESS kit");
    // the Secret project's task also mentions "press" and must not appear
    expect(body.tasks.map((t: { title: string }) => t.title).sort()).toEqual([
      "Draft press release",
      "Record demo video",
    ]);
  });

  it("returns the same shape as the unfiltered listing (camelCase + assignee)", async () => {
    const { body } = await search("press release");
    expect(body.tasks).toHaveLength(1);
    const [task] = body.tasks;
    expect(task.projectId).toBe(fx.launch.id);
    expect(task.assigneeId).toBe(fx.member.id);
    expect(task.assignee).toEqual({ id: fx.member.id, name: "member", email: "member@test.dev" });
    expect(task).not.toHaveProperty("project_id");
  });

  it("treats quotes in the search term as literal text", async () => {
    const { status, body } = await search("O'Brien");
    expect(status).toBe(200);
    expect(body.tasks.map((t: { title: string }) => t.title)).toEqual(["O'Brien's launch checklist"]);
  });

  it("treats LIKE wildcards in the search term as literal text", async () => {
    const { body } = await search("%");
    expect(body.tasks.map((t: { title: string }) => t.title)).toEqual(["Update pricing page"]);
  });

  it("returns the full list for a blank search term", async () => {
    const { body } = await search("   ");
    expect(body.tasks).toHaveLength(4);
  });

  it("rejects overly long search terms", async () => {
    const { status } = await search("a".repeat(201));
    expect(status).toBe(400);
  });

  describe("SQL injection", () => {
    it("does not let a boolean payload widen the filter", async () => {
      const { status, body } = await search("zzz' OR '1'='1' OR title ILIKE '");
      expect(status).toBe(200);
      expect(body.tasks).toEqual([]);
    });

    it("does not leak other projects' tasks via UNION", async () => {
      const { status, body, text } = await search(
        "zzz') UNION SELECT id, project_id, title, description, status, assignee_id, created_by_id, position, created_at, updated_at FROM tasks --",
      );
      expect(status).toBe(200);
      expect(body.tasks).toEqual([]);
      expect(text).not.toContain(fx.secretTask.title);
    });

    it("does not leak users or password hashes via UNION", async () => {
      const { status, body, text } = await search(
        `zzz') UNION SELECT id, 'users', email, password_hash, 'todo'::"TaskStatus", NULL, id, 0, created_at, updated_at FROM users --`,
      );
      expect(status).toBe(200);
      expect(body.tasks).toEqual([]);
      expect(text).not.toContain("$2a$");
      expect(text).not.toContain("outsider@test.dev");
    });

    it("cannot be used from an attacker's own project to read other projects", async () => {
      const { body, text } = await search(
        "zzz') UNION SELECT id, project_id, title, description, status, assignee_id, created_by_id, position, created_at, updated_at FROM tasks --",
        fx.outsider.token,
        fx.secret.id,
      );
      expect(body.tasks).toEqual([]);
      expect(text).not.toContain("Draft press release");
    });

    it("leaves the database intact after a stacked-statement payload", async () => {
      await search(`zzz'); DELETE FROM tasks; --`).catch(() => undefined);
      const { body } = await search("");
      expect(body.tasks).toHaveLength(4);
    });
  });

  describe("authorization", () => {
    it("rejects non-members", async () => {
      const { status } = await search("press", fx.outsider.token);
      expect(status).toBe(403);
    });

    it("rejects unauthenticated requests", async () => {
      const url = `/api/projects/${fx.launch.id}/tasks?q=press`;
      const res = await GET(authedRequest(url, null), params({ id: fx.launch.id }));
      expect(res.status).toBe(401);
    });
  });
});
