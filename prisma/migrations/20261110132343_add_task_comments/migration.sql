-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_comments_task_id_created_at_idx" ON "task_comments"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "task_comments_project_id_created_at_idx" ON "task_comments"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_id_project_id_key" ON "tasks"("id", "project_id");

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_project_id_fkey" FOREIGN KEY ("task_id", "project_id") REFERENCES "tasks"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Append-only enforcement (hand-written; Prisma cannot express triggers).
-- Comments are part of the engagement audit trail, so any UPDATE or DELETE is
-- rejected at the database level, regardless of which code path issues it.
-- TRUNCATE is intentionally not blocked: it is only used by test/dev resets.
CREATE FUNCTION "task_comments_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'task_comments is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_comments_no_update_delete"
  BEFORE UPDATE OR DELETE ON "task_comments"
  FOR EACH ROW EXECUTE FUNCTION "task_comments_append_only"();
