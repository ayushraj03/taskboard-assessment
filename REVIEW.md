# Code review — TaskBoard

Top 4 issues, ordered by business impact. Line references are to the original
code at commit [`8b59efc`](https://github.com/ayushraj03/taskboard-assessment/tree/8b59efc).
Every issue below was reproduced against the running app (seed data,
`docker-compose up`); full output is in [TERMINAL_LOG.md](TERMINAL_LOG.md).

| # | Issue | Category | Severity | Status |
|---|---|---|---|---|
| 1 | SQL injection in task search | Security | **Critical** | **Fixed** (`d7156ad`) |
| 2 | Task update has no authorization | Security | **Critical** | Open |
| 3 | Password hashes returned by project detail API | Security | High | Open |
| 4 | User email is not unique | Data Integrity | High | Open |

---

## 1. SQL injection in task search — Security · Critical · ✅ fixed

**Where:** [`src/app/api/projects/[id]/tasks/route.ts:23-36`](https://github.com/ayushraj03/taskboard-assessment/blob/8b59efc/src/app/api/projects/%5Bid%5D/tasks/route.ts#L23-L36)

The `?q=` search term is interpolated into a SQL string and run with
`prisma.$queryRawUnsafe`. Any project member — including a **viewer**, or a
**brand-new self-registered user on a project they just created** — can
`UNION` out every task in every project and every user's email and bcrypt
hash. Because registration is open, this is effectively a full database read
for anyone on the internet; it also 500s on any search containing a quote
(`O'Brien`).

**Fix:** use the same parameterized `prisma.task.findMany` as the plain listing
(`contains` + `mode: "insensitive"`), escape LIKE wildcards, validate/trim `q`
(≤200 chars), and remove the raw query entirely. Implemented in `d7156ad` with
13 integration tests against real Postgres (9 fail on the old code).

**Proof (before the fix)** — `dev@example.com` is a *viewer* on Q3 Launch only:

```console
$ curl -s -G -H "Authorization: Bearer $DEV_TOKEN" http://localhost:3000/api/projects/$PROJECT_ID/tasks \
    --data-urlencode "q=zzz') UNION SELECT id, 'users', email, password_hash, 'todo'::\"TaskStatus\", NULL, id, 0, created_at, updated_at FROM users --"
HTTP 200 | rows: 5 | rows from OTHER projects: 5
   LEAK  {"project_id":"users","title":"dev@example.com","description":"$2a$10$vyZV8v8sGvEnz/x1/oO9U.e8jv0IbsAM7lJyldMxc7Z09TYXXO6DS"}
   LEAK  {"project_id":"users","title":"arjun@taskboard.dev","description":"$2a$10$vyZV8v8sGvEnz/x1/oO9U.e8jv0IbsAM7lJyldMxc7Z09TYXXO6DS"}
   LEAK  {"project_id":"users","title":"meera@taskboard.dev","description":"$2a$10$vyZV8v8sGvEnz/x1/oO9U.e8jv0IbsAM7lJyldMxc7Z09TYXXO6DS"}
   ...

# zero-invite attack: freshly registered account, own project, reads all 12 tasks of other projects
$ curl -s -G -H "Authorization: Bearer $ATTACKER_TOKEN" http://localhost:3000/api/projects/$ATTACKER_PROJECT/tasks \
    --data-urlencode "q=zzz') UNION SELECT id, project_id, title, description, status, assignee_id, created_by_id, position, created_at, updated_at FROM tasks --"
HTTP 200 | rows: 12 | rows from OTHER projects: 12
```

**After the fix** — identical commands:

```console
HTTP 200 | rows: 0 | rows from OTHER projects: 0     # users dump
HTTP 200 | rows: 0 | rows from OTHER projects: 0     # zero-invite attack
```

---

## 2. Task update has no authorization — Security · Critical · open

**Where:** [`src/app/api/tasks/[id]/route.ts:16-37`](https://github.com/ayushraj03/taskboard-assessment/blob/8b59efc/src/app/api/tasks/%5Bid%5D/route.ts#L16-L37)

`PATCH /api/tasks/:id` only checks that the caller is logged in; it never
checks project membership or role, while `DELETE` in the same file does. Any
authenticated user (and registration is open) can rename, re-status or
reassign any task in any project, and viewers can edit tasks they should only
read. `assigneeId` is also unvalidated, so tasks can be assigned to
non-members, and a non-existent id produces a 500 (FK violation).

**Fix:** load the task's `projectId`, require a membership with
`canEditTasks(role)` (403 otherwise), and reject an `assigneeId` that is not a
member of that project (400). The `getTaskAccess()` helper added for comments
already does the lookup. Add integration tests per role.

**Proof** — `lina@example.com` is *not* a member of Q3 Launch:

```console
$ curl -s -w "\nHTTP %{http_code}\n" -X PATCH http://localhost:3000/api/tasks/$TASK_ID \
    -H "Authorization: Bearer $LINA_TOKEN" -H "Content-Type: application/json" -d '{"status":"in_progress"}'
{"task":{"id":"cmwapkdwl000rpf955s5tu5q9","projectId":"cmwapkdw40006pf9594vauphk","title":"Record demo video",...}}
HTTP 200

# viewer (dev) can edit too
HTTP 200

# DELETE in the same file *does* check membership
$ curl -s -w "\nHTTP %{http_code}\n" -X DELETE http://localhost:3000/api/tasks/$TASK_ID -H "Authorization: Bearer $LINA_TOKEN"
{"error":"you are not a member of this project"}
HTTP 403
```

---

## 3. Password hashes returned by the project detail API — Security · High · open

**Where:** [`src/app/api/projects/[id]/route.ts:25-40`](https://github.com/ayushraj03/taskboard-assessment/blob/8b59efc/src/app/api/projects/%5Bid%5D/route.ts#L25-L40)
(`owner: true`, `memberships: { include: { user: true } }`, `assignee: true`, `createdBy: true`);
the leak is even encoded in the client type at
[`src/types/index.ts:27`](https://github.com/ayushraj03/taskboard-assessment/blob/8b59efc/src/types/index.ts#L27).

`include: { user: true }` returns the full `User` row, so every member —
including viewers — receives the bcrypt hash of the owner, every member, and
every assignee/creator, and the browser keeps them in the React Query cache.
Offline cracking of weak passwords then becomes possible for anyone with
viewer access.

**Fix:** replace every `include: { user: true }` with an explicit
`select: { id, name, email }` (a shared `publicUserSelect` constant), drop
`passwordHash` from `ApiProjectMember`/`ApiProjectDetail`, and add a test that
asserts no response body contains `passwordHash`.

**Proof** — as `dev@example.com` (viewer):

```console
$ curl -s http://localhost:3000/api/projects/$PROJECT_ID -H "Authorization: Bearer $DEV_TOKEN" | node -pe "...passwordHash"
owner.passwordHash: $2a$10$vyZV8v8sGvEnz/x1/oO9U.e8jv0IbsAM7lJyldMxc7Z09TYXXO6DS
meera@taskboard.dev  $2a$10$vyZV8v8sGvEnz/x1/oO9U.e8jv0IbsAM7lJyldMxc7Z09TYXXO6DS
arjun@taskboard.dev  $2a$10$vyZV8v8sGvEnz/x1/oO9U.e8jv0IbsAM7lJyldMxc7Z09TYXXO6DS
...
```

---

## 4. User email is not unique — Data Integrity · High · open

**Where:** [`prisma/schema.prisma:25`](https://github.com/ayushraj03/taskboard-assessment/blob/8b59efc/prisma/schema.prisma#L25)
(no `@unique`; the migration creates no index), with a check-then-insert in
[`src/app/api/auth/register/route.ts:17-26`](https://github.com/ayushraj03/taskboard-assessment/blob/8b59efc/src/app/api/auth/register/route.ts#L17-L26)
and `findFirst` in [`src/app/api/auth/login/route.ts:16`](https://github.com/ayushraj03/taskboard-assessment/blob/8b59efc/src/app/api/auth/login/route.ts#L16).

Uniqueness is only enforced by a racy "find, then create", so two concurrent
sign-ups create duplicate accounts, and emails are compared case-sensitively
(`Meera@…` and `meera@…` are different users). Login then picks an arbitrary
row with `findFirst`, so a user can be logged into the wrong account, and
membership/ownership checks keyed by user id silently diverge.

**Fix:** normalize emails (`trim().toLowerCase()`) in the zod schemas, add
`@unique` on `User.email` (after a migration that de-duplicates existing rows),
switch login to `findUnique`, and map Prisma `P2002` on register to a 409.

---

## Other findings (not in the top 4)

- **Performance** — `GET /api/projects` loads every task row of every project
  just to compute `taskCount` ([`src/app/api/projects/route.ts:16`](https://github.com/ayushraj03/taskboard-assessment/blob/8b59efc/src/app/api/projects/route.ts#L16));
  use `_count: { select: { tasks: true } }`. Project detail loads all tasks with
  no pagination.
- **Architecture** — no `middleware.ts`: auth is a client-side `useEffect`
  redirect, so protected pages render and fire API calls first. No
  `error.tsx` / `global-error.tsx` / `not-found.tsx` / `loading.tsx`, no route
  groups for authed vs. public layouts (the `Header` is repeated per page), and
  every page is a client component. `apiFetch` doesn't clear the session on 401
  and crashes on non-JSON error pages.
- **Testing** — the original suite (12 tests) covered schemas, JWT helpers and
  one component; no API route or authorization test existed, which is how
  issues 1–3 shipped.
- **UX/authz mismatch** — viewers see the add-task form and edit/delete buttons
  (the server rejects them, except for issue 2).
- **Sessions** — 30-day JWTs in `localStorage`, no revocation.
- **Data integrity** — task `position` is computed with read-then-insert, so
  concurrent creates can collide.
