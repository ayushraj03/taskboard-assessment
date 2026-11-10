# TaskBoard — Project Management App

A Next.js 15 fullstack application for managing projects, tasks, and team members. TypeScript + Prisma + PostgreSQL on the server, React 19 + TanStack Query on the client.

## Assessment submission

| | |
|---|---|
| Screen recording | [RECORDING.md](RECORDING.md) |
| Part 1 — code review | [REVIEW.md](REVIEW.md) |
| Part 2 — fix | SQL injection in task search, fixed in `d7156ad` (proof in [TERMINAL_LOG.md](TERMINAL_LOG.md#3-bug-curl-proof-before-fix)) |
| Part 3a — task comments | done: append-only comments in the task modal |
| Part 3c — Airtable export | done: async export from the project page |
| Part 3b — activity feed | not attempted |
| Design decisions | [DESIGN_NOTES.md](DESIGN_NOTES.md) |
| Terminal log | [TERMINAL_LOG.md](TERMINAL_LOG.md) |

**Tests:** `docker-compose exec web npm test` runs 116 tests: unit tests plus
integration tests against a separate `taskboard_test` database, which is
created and migrated automatically.

### Airtable export setup

1. In an Airtable base, create a table `Tasks` with these columns:
   `TaskBoard ID` (primary), `Title`, `Description`, `Status`, `Assignee`,
   `Project`, `Position`, `Created At`, `Updated At`, `Last Exported At`.
   Single line text works for all of them; Status can also be single select,
   Position a number, and the dates date fields.
2. Create a personal access token with scopes `data.records:read` and
   `data.records:write`, limited to that base.
3. Put the values in `.env` next to `docker-compose.yml` (gitignored):
   ```
   AIRTABLE_API_KEY="pat..."
   AIRTABLE_BASE_ID="app..."
   AIRTABLE_TABLE_NAME="Tasks"
   ```
4. Run `docker-compose up -d web`, then click **export to Airtable** on a project page (admins and members only).

### Notes for running on Windows

- If the web container exits with `bash\r: No such file or directory`, the
  scripts were checked out with CRLF line endings. Fix with
  `sed -i 's/\r$//' bin/docker-entrypoint bin/setup .git-hooks/pre-commit`.
- The dev server inside Docker doesn't pick up file changes from a Windows
  host. Run `docker-compose restart web` after editing code.
- Once comments exist, re-seed with `npm run db:reset` rather than `db:seed`:
  comments are append-only, so `db:seed` can't delete the tasks they belong to.

## Quick Setup (Docker — Recommended)

```bash
# Clone and enter the repo
git clone <repo-url> && cd taskboard

# Start the app and database
docker-compose up --build

# In a separate terminal, set up the database
docker-compose exec web npm run db:seed

# Run the test suite
docker-compose exec web npm test

# The app is now running at http://localhost:3000
```

## Manual Setup (without Docker)

Requires: Node.js 20+, PostgreSQL 15+

```bash
# Run the setup script (installs deps, sets up DB, configures git hooks)
chmod +x bin/setup
./bin/setup

# Or do it manually:
npm install
git config core.hooksPath .git-hooks
cp .env.example .env   # then edit DATABASE_URL if your local Postgres differs
npx prisma migrate deploy
npx prisma generate
npm run db:seed
npm test
npm run dev
```

## AI Tool Conversation Tracking

**This repository is configured to automatically capture your AI coding tool conversation history with each git commit.** This includes conversations from Claude Code, Cursor, Aider, Continue.dev, Cody, Cline, and Windsurf.

This is part of the Ajackus evaluation process. We evaluate how you collaborate with AI tools — your prompting strategy, how you break down problems, and how you review AI suggestions. The captured conversations help us understand your workflow.

**How it works:**
- A pre-commit git hook runs automatically before each commit
- It copies conversation files from AI tool directories (e.g., `.claude/`, `.cursor/`) into `.ai-conversations/`
- These files are staged and included in your commit
- You don't need to do anything — it happens automatically

**What's captured:** Only AI tool conversation logs stored in the project directory. No system files, browsing history, or anything outside this repository.

**If you prefer a tool that doesn't store local conversations** (like browser-based ChatGPT), the screen recording will capture your interactions instead. No additional action needed from you.

## Seed Data

The seed file creates:
- 5 users across 3 projects with different roles (admin / member / viewer)
- 3 projects with realistic task distributions
- 12 tasks spanning all four statuses (`todo`, `in_progress`, `review`, `done`)

All user passwords are: `password123`

| Email | Role on which project |
|-------|----------------------|
| meera@taskboard.dev | admin on Q3 Launch & Internal Tools, member on Onboarding |
| arjun@taskboard.dev | admin on Onboarding, member on Q3 Launch |
| kavya@example.com | member on Q3 Launch |
| dev@example.com | viewer on Q3 Launch |
| lina@example.com | member on Onboarding |

## Authentication

Register or login to get a JWT token:

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"meera@taskboard.dev","password":"password123"}'

# Use the returned token
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/projects
```

## API Endpoints

### Auth
- `POST /api/auth/register` — Create account
- `POST /api/auth/login` — Sign in, get JWT
- `GET /api/users/me` — Current user (authenticated)

### Projects
- `GET /api/projects` — List projects you're a member of (authenticated)
- `POST /api/projects` — Create a project (authenticated; creator becomes admin)
- `GET /api/projects/:id` — Project detail with tasks and members (authenticated)
- `PATCH /api/projects/:id` — Update project (authenticated)
- `DELETE /api/projects/:id` — Delete project (authenticated)

### Tasks
- `GET /api/projects/:id/tasks` — List tasks in a project (authenticated)
- `POST /api/projects/:id/tasks` — Create a task (authenticated)
- `PATCH /api/tasks/:id` — Update a task (authenticated)
- `DELETE /api/tasks/:id` — Delete a task (authenticated)

## Tech Stack

- Node.js 20 (runtime)
- Next.js 15 (App Router) / React 19
- TypeScript 5 (strict mode)
- Prisma 6 + PostgreSQL 16
- TanStack Query 5 (client data)
- Zod 3 (schema validation)
- Tailwind CSS 3
- bcryptjs + jsonwebtoken
- Vitest 2 (testing)
