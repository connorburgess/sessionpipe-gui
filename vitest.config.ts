// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "server/**/*.test.ts", "shared/**/*.test.ts", "web/src/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
  },
});
