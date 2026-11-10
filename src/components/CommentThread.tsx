"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ApiComment } from "@/types";

type Props = {
  taskId: string;
  canPost: boolean;
};

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function CommentThread({ taskId, canPost }: Props) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["task-comments", taskId],
    queryFn: () => apiFetch<{ comments: ApiComment[] }>(`/api/tasks/${taskId}/comments`),
  });

  const postComment = useMutation({
    mutationFn: (text: string) =>
      apiFetch<{ comment: ApiComment }>(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      }),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["task-comments", taskId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "failed to post comment"),
  });

  const comments = data?.comments ?? [];

  return (
    <section className="mt-6 border-t border-border pt-4">
      <h3 className="text-sm font-medium mb-3">
        comments {comments.length > 0 && <span className="text-muted">({comments.length})</span>}
      </h3>

      {isLoading && <p className="text-xs text-muted">loading comments…</p>}
      {queryError && (
        <p className="text-xs text-red-400" role="alert">
          {queryError instanceof Error ? queryError.message : "failed to load comments"}
        </p>
      )}
      {data && comments.length === 0 && <p className="text-xs text-muted italic">no comments yet</p>}

      {comments.length > 0 && (
        <ol className="space-y-3 mb-4">
          {comments.map((c) => (
            <li key={c.id} className="bg-bg border border-border rounded-md p-3">
              <div className="flex items-center justify-between text-xs text-muted mb-1">
                <span className="font-medium text-white">{c.author.name}</span>
                <time dateTime={c.createdAt} title={c.createdAt}>
                  {timeFormat.format(new Date(c.createdAt))}
                </time>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          ))}
        </ol>
      )}

      {canPost ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            setError(null);
            postComment.mutate(body.trim());
          }}
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={5000}
            placeholder="add a comment"
            aria-label="add a comment"
            className="block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          {error && (
            <p className="text-xs text-red-400 mt-1" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-muted">comments can't be edited or deleted once posted</span>
            <button
              type="submit"
              disabled={postComment.isPending || !body.trim()}
              className="text-sm px-3 py-1.5 rounded-md bg-accent text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {postComment.isPending ? "posting…" : "post"}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-muted italic">viewers can read comments but cannot post</p>
      )}
    </section>
  );
}
