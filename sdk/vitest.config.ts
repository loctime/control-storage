import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/index.ts", "src/types/**"],
    },
  },
  define: {
    __SDK_VERSION__: JSON.stringify("0.0.0-test"),
  },
});
