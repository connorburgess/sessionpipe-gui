import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "server/**/*.test.ts", "shared/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
  },
});
