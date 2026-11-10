import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExportPanel } from "@/components/ExportPanel";
import type { ApiExportRun } from "@/types";

const apiFetch = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const baseRun: ApiExportRun = {
  id: "run_1",
  target: "airtable",
  status: "succeeded",
  total: 12,
  exported: 12,
  failed: 0,
  failures: [],
  error: null,
  startedAt: "2026-01-01T10:00:00.000Z",
  finishedAt: "2026-01-01T10:00:05.000Z",
  triggeredBy: { id: "u_1", name: "Meera Iyer" },
};

function respondWith(run: ApiExportRun | null) {
  apiFetch.mockImplementation((_path: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === "POST"
        ? { run: { ...baseRun, status: "running" } }
        : { run, destinationUrl: "https://airtable.com/appXYZ" },
    ),
  );
}

function renderPanel(canExport: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ExportPanel projectId="p_1" canExport={canExport} />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiFetch.mockReset());

describe("<ExportPanel />", () => {
  it("lets members start an export", async () => {
    respondWith(null);
    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "export to Airtable" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/api/projects/p_1/exports/airtable", { method: "POST" }),
    );
  });

  it("hides the export button from viewers but still shows the last result", async () => {
    respondWith(baseRun);
    renderPanel(false);
    expect(await screen.findByText("last export: 12 tasks exported")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /export to airtable/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "open in Airtable" })).toHaveAttribute("href", "https://airtable.com/appXYZ");
  });

  it("shows progress and disables the button while running", async () => {
    respondWith({ ...baseRun, status: "running", exported: 4, failed: 1, finishedAt: null });
    renderPanel(true);
    expect(await screen.findByText("exporting… 5 / 12 tasks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "exporting…" })).toBeDisabled();
  });

  it("lists failed records on demand", async () => {
    respondWith({
      ...baseRun,
      status: "completed_with_errors",
      exported: 11,
      failed: 1,
      failures: [{ key: "t_9", label: "Update pricing page", error: "INVALID_VALUE_FOR_COLUMN (HTTP 422)" }],
    });
    renderPanel(true);
    expect(await screen.findByText("last export: 11 exported, 1 failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "show failed records" }));
    expect(screen.getByText("Update pricing page")).toBeInTheDocument();
  });

  it("shows the reason when an export failed outright", async () => {
    respondWith({ ...baseRun, status: "failed", exported: 0, failed: 12, error: "AUTHENTICATION_REQUIRED (HTTP 401)" });
    renderPanel(true);
    expect(await screen.findByText("last export failed: AUTHENTICATION_REQUIRED (HTTP 401)")).toBeInTheDocument();
  });
});
