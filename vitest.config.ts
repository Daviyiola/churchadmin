import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    // Bound parallel transforms/jsdom processes on developer machines.
    maxWorkers: 4,
    environment: "node", include: ["tests/**/*.test.{ts,tsx}"], setupFiles: ["tests/setup.ts"],
    coverage: { provider: "v8", reporter: ["text", "html", "json-summary", "json"], include: ["lib/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"], exclude: ["**/types.ts"], reportsDirectory: "coverage" },
  },
});
