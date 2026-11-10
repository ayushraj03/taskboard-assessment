import type { TaskStatus } from "@prisma/client";
import { STATUS_LABELS } from "@/types";
import type { ExportRow } from "./types";

/** Airtable field that uniquely identifies a task; upserts merge on it. */
export const MERGE_FIELD = "TaskBoard ID";

export type ExportableTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  assignee: { name: string } | null;
};

/**
 * Maps a task to the Airtable "Tasks" table columns. Only the assignee's
 * name is exported — no emails or other personal data leave TaskBoard.
 */
export function toExportRow(task: ExportableTask, projectName: string, exportedAt: Date): ExportRow {
  return {
    key: task.id,
    label: task.title,
    fields: {
      [MERGE_FIELD]: task.id,
      Title: task.title,
      Description: task.description ?? "",
      Status: STATUS_LABELS[task.status],
      Assignee: task.assignee?.name ?? "",
      Project: projectName,
      // sent as a string: with typecast, Airtable accepts it in both text and
      // number columns, whereas a raw number is rejected by text columns
      Position: String(task.position),
      "Created At": task.createdAt.toISOString(),
      "Updated At": task.updatedAt.toISOString(),
      "Last Exported At": exportedAt.toISOString(),
    },
  };
}
