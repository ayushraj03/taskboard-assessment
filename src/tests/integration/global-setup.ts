import { execSync } from "node:child_process";

/**
 * Runs once before the integration suite: applies migrations to the test
 * database (creating it if needed). Refuses to run against anything that does
 * not look like a dedicated test database, because the tests truncate tables.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for integration tests");

  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `refusing to run integration tests against "${dbName}": database name must end in _test`,
    );
  }

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
