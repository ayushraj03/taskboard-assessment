import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommentThread } from "@/components/CommentThread";
import type { ApiComment } from "@/types";

const apiFetch = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const comments: ApiComment[] = [
  {
    id: "c_1",
    taskId: "t_1",
    body: "first pass done",
    createdAt: "2026-01-01T10:00:00.000Z",
    author: { id: "u_1", name: "Meera Iyer" },
  },
  {
    id: "c_2",
    taskId: "t_1",
    body: "<b>not bold</b>",
    createdAt: "2026-01-01T11:00:00.000Z",
    author: { id: "u_2", name: "Kavya Reddy" },
  },
];

function renderThread(canPost: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommentThread taskId="t_1" canPost={canPost} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((_path: string, init?: RequestInit) =>
    Promise.resolve(init?.method === "POST" ? { comment: comments[0] } : { comments }),
  );
});

describe("<CommentThread />", () => {
  it("renders each comment's author, body and timestamp in order", async () => {
    renderThread(true);
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Meera Iyer");
    expect(items[0]).toHaveTextContent("first pass done");
    expect(items[1]).toHaveTextContent("Kavya Reddy");
    expect(items[0].querySelector("time")).toHaveAttribute("dateTime", "2026-01-01T10:00:00.000Z");
  });

  it("renders comment bodies as text, not HTML", async () => {
    renderThread(true);
    expect(await screen.findByText("<b>not bold</b>")).toBeInTheDocument();
  });

  it("shows a composer to members and posts the trimmed body", async () => {
    renderThread(true);
    const box = await screen.findByLabelText("add a comment");
    fireEvent.change(box, { target: { value: "  ready for review  " } });
    fireEvent.click(screen.getByRole("button", { name: "post" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/api/tasks/t_1/comments", {
        method: "POST",
        body: JSON.stringify({ body: "ready for review" }),
      }),
    );
  });

  it("hides the composer from viewers", async () => {
    renderThread(false);
    await screen.findAllByRole("listitem");
    expect(screen.queryByLabelText("add a comment")).not.toBeInTheDocument();
    expect(screen.getByText(/viewers can read comments but cannot post/)).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    apiFetch.mockResolvedValue({ comments: [] });
    renderThread(true);
    expect(await screen.findByText("no comments yet")).toBeInTheDocument();
  });
});
