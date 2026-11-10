"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ApiExportRun } from "@/types";

type Props = {
  projectId: string;
  canExport: boolean;
};

type ExportStatusResponse = { run: ApiExportRun | null; destinationUrl: string | null };

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ExportPanel({ projectId, canExport }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ["airtable-export", projectId];
  const [error, setError] = useState<string | null>(null);
  const [showFailures, setShowFailures] = useState(false);

  const { data } = useQuery({
    queryKey,
    queryFn: () => apiFetch<ExportStatusResponse>(`/api/projects/${projectId}/exports/airtable`),
    // poll while an export is in progress
    refetchInterval: (query) => (query.state.data?.run?.status === "running" ? 1500 : false),
  });

  const startExport = useMutation({
    mutationFn: () =>
      apiFetch<{ run: ApiExportRun }>(`/api/projects/${projectId}/exports/airtable`, { method: "POST" }),
    onMutate: () => setError(null),
    onError: (err) => setError(err instanceof Error ? err.message : "export failed to start"),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const run = data?.run;
  const running = run?.status === "running";

  return (
    <div className="text-right text-xs text-muted min-w-[16rem]">
      {canExport && (
        <button
          onClick={() => startExport.mutate()}
          disabled={running || startExport.isPending}
          className="text-sm px-3 py-1.5 rounded-md border border-border hover:border-accent disabled:opacity-50"
        >
          {running ? "exporting…" : "export to Airtable"}
        </button>
      )}

      {error && (
        <p className="text-red-400 mt-2" role="alert">
          {error}
        </p>
      )}

      {run && (
        <div className="mt-2 space-y-1" aria-live="polite">
          <p>{describeRun(run)}</p>
          <p>
            {run.triggeredBy.name} · {timeFormat.format(new Date(run.startedAt))}
            {data?.destinationUrl && run.exported > 0 && (
              <>
                {" · "}
                <a href={data.destinationUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  open in Airtable
                </a>
              </>
            )}
          </p>
          {run.failures.length > 0 && (
            <div>
              <button onClick={() => setShowFailures((v) => !v)} className="text-red-400 hover:underline">
                {showFailures ? "hide" : "show"} failed records
              </button>
              {showFailures && (
                <ul className="mt-1 space-y-1 text-left">
                  {run.failures.map((f) => (
                    <li key={f.key} className="text-red-400">
                      <span className="text-white">{f.label}</span>: {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function describeRun(run: ApiExportRun): string {
  switch (run.status) {
    case "running":
      return `exporting… ${run.exported + run.failed} / ${run.total || "?"} tasks`;
    case "succeeded":
      return `last export: ${run.exported} ${run.exported === 1 ? "task" : "tasks"} exported`;
    case "completed_with_errors":
      return `last export: ${run.exported} exported, ${run.failed} failed`;
    case "failed":
      return `last export failed: ${run.error ?? "unknown error"}`;
  }
}
