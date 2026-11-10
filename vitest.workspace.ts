import { defineWorkspace } from "vitest/config";
import path from "node:path";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.warn(
    "\n[vitest] TEST_DATABASE_URL is not set — skipping integration tests.\n" +
      "         Run inside docker (`docker-compose exec web npm test`) or export TEST_DATABASE_URL.\n",
  );
}

export default defineWorkspace([
  "./vitest.config.ts",
  ...(testDatabaseUrl
    ? [
        {
          test: {
            name: "integration",
            environment: "node",
            globals: true,
            include: ["src/tests/integration/**/*.test.ts"],
            setupFiles: ["./src/tests/setup.ts"],
            globalSetup: ["./src/tests/integration/global-setup.ts"],
            // every file truncates the same database, so files must not run concurrently
            pool: "forks",
            poolOptions: { forks: { singleFork: true } },
            env: { DATABASE_URL: testDatabaseUrl },
          },
          resolve: {
            alias: { "@": path.resolve(__dirname, "./src") },
          },
        },
      ]
    : []),
]);
