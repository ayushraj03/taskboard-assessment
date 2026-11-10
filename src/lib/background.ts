import { after } from "next/server";

/**
 * Runs work after the response has been sent (Next.js `after`). Isolated in
 * its own module so tests can run the work inline and await it.
 */
export function runInBackground(task: () => Promise<unknown>) {
  after(task);
}
