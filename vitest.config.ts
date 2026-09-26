import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["packages/*/**/*.ts"],
      exclude: ["**/node_modules/**", "**/.pi/**", "**/dist/**", "**/*.test.ts", "**/*.d.ts"],
    },
    projects: [
      {
        test: {
          name: "core",
          include: ["packages/*/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/.pi/**", "**/dist/**", "packages/pi-subagents/**"],
          setupFiles: ["./test/setup.ts"],
          hookTimeout: 30_000,
          unstubGlobals: true,
          clearMocks: true,
          restoreMocks: true,
        },
      },
      {
        test: {
          name: "pi-subagents",
          include: ["packages/pi-subagents/test/**/*.test.ts", "packages/pi-subagents/ship-manifest.test.ts"],
          setupFiles: ["./packages/pi-subagents/test/support/vitest.setup.ts"],
          hookTimeout: 60_000,
          testTimeout: 60_000,
          unstubGlobals: true,
        },
      },
    ],
  },
});
