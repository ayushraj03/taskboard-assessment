-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('running', 'succeeded', 'completed_with_errors', 'failed');

-- CreateTable
CREATE TABLE "export_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "triggered_by_id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'running',
    "total" INTEGER NOT NULL DEFAULT 0,
    "exported" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "failures" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "export_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_runs_project_id_started_at_idx" ON "export_runs"("project_id", "started_at");

-- AddForeignKey
ALTER TABLE "export_runs" ADD CONSTRAINT "export_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_runs" ADD CONSTRAINT "export_runs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

