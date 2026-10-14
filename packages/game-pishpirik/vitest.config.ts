import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Full-match random playouts are CPU-bound and legitimately take several seconds.
    testTimeout: 120_000,
  },
});
