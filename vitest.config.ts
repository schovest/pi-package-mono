import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    hookTimeout: 30_000,
    unstubGlobals: true,
    clearMocks: true,
    restoreMocks: true,
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["packages/*/**/*.ts"],
      exclude: ["**/node_modules/**", "**/.pi/**", "**/dist/**", "**/*.test.ts", "**/*.d.ts"],
    },
  },
});
