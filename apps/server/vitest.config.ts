import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/setup/global.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Database tests share one database and truncate between tests, so files run serially.
    fileParallelism: false,
  },
});
