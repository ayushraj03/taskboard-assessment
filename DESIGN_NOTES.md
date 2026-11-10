# Design notes

Decisions behind Part 2 (fix), Part 3a (task comments) and Part 3c (Airtable
export). Part 3b (activity feed) was not attempted.

## Part 2 — SQL injection fix

- Search now uses the same `prisma.task.findMany` as the plain listing instead
  of a second, hand-written query. One code path means no raw SQL to regress,
  and search results finally have the same shape as the listing (they used to
  be snake_case rows without `assignee`).
- Prisma binds `contains` as a parameter but does **not** escape `%`/`_`; the
  test suite caught this, so wildcards are escaped explicitly.
- Tests run against a real `taskboard_test` Postgres database (not a mocked
  client), because the claim to prove is "this SQL can't be injected". The
  harness refuses to run unless the database name ends in `_test`, since it
  truncates tables.

## Part 3a — task comments

**Append-only is enforced by the database, not just by the API.** Comments are
part of the engagement audit trail, so "there is no edit endpoint" isn't
enough: a `BEFORE UPDATE OR DELETE` trigger on `task_comments` raises for any
modification, whatever code path issues it. The route also exports only `GET`
and `POST`, so `PATCH`/`PUT`/`DELETE` get a 405.

**Deleting a commented task or project is refused (409).** The existing task
and project deletes were hard deletes with cascades, which would silently erase
the audit trail. All comment foreign keys are `ON DELETE RESTRICT`, and the
routes check first so users get a clear 409 instead of a 500. Soft-deleting
tasks would keep "delete" working, but it touches every task query (listing,
counts, export); refusing is smaller and can't lose data. Soft delete is the
natural follow-up if product wants commented tasks to be removable.

**Other choices**
- Author and timestamp come only from the server (JWT user, DB `now()`); a
  client-sent `authorId`/`createdAt` is ignored, so comments can't be forged or
  backdated.
- `projectId` is denormalized onto each comment for project-scoped queries
  (activity feed, export) and kept honest by a composite FK to
  `tasks(id, project_id)`.
- Authors are exposed as `{ id, name }` only, so the comment API can't repeat the
  password-hash leak (REVIEW.md #3).
- Viewers read but cannot post; the UI hides the composer, and the API enforces
  it (403).

Trade-off: `prisma/seed.ts` deletes tasks, so once comments exist, re-seed with
`npm run db:reset` (drops and recreates the database) rather than `db:seed`.

## Part 3c — Airtable export

**Idempotency uses Airtable's upsert, not client-chosen record ids.** The
provided `airtable-mock.ts` treats `create({ id: task.id })` as an upsert, but
real Airtable assigns its own `rec…` ids and ignores ours; copying the mock
would create duplicates on every run. The real target calls
`table.update(records, { performUpsert: { fieldsToMergeOn: ["TaskBoard ID"] } })`,
so re-running updates rows in place. The mock is still used as the test double
via a small adapter.

**Error policy** (`src/lib/export/classify.ts`)

| Class | Examples | Behaviour |
|---|---|---|
| transient | 429, 5xx, network/timeout | retried up to 4 attempts, exponential backoff + jitter; 429 waits ≥30s as Airtable requires |
| permanent | 422 invalid value, 400 | not retried; the batch of 10 is re-sent row by row so one bad record doesn't fail the other nine |
| fatal | 401, 403, 404, `UNKNOWN_FIELD_NAME` | abort the run immediately with the reason; every record would fail the same way |

The `airtable` package's own 429 retry is disabled (`noRetryIfRateLimited`):
it retries forever and never retries 5xx/network errors, so all retrying goes
through the one bounded, tested policy. Requests are batched (10 per call) and
throttled to stay under 5 requests/second per base.

**Async (bonus).** `POST` creates an `ExportRun` row and returns 202; the
export runs after the response via Next's `after()` and writes progress, which
the UI polls. ~1,000 tasks is ~100 throttled calls (~20s), too long to hold a
request open. Only one export runs per project at a time: a
transaction-scoped Postgres advisory lock serializes concurrent clicks (the
loser gets 409), and a run stuck "running" for 15+ minutes is marked stale.
Limitation: `after()` runs in-process, so a server restart mid-export leaves
the run stale rather than resuming it; a durable job queue would fix that.

**Data choices**
- Tasks deleted in TaskBoard are **not** deleted from Airtable. Deleting rows in
  someone else's system on a bug is worse than a stale row, and
  `Last Exported At` makes stale rows visible.
- Only the assignee's **name** is exported, never their email.
- `Position` is sent as a string, so it works in both text and number columns
  (found on the first real run: a text column rejects a raw number even with
  `typecast`).
