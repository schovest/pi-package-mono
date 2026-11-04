import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  type ChildSessionLaunch,
  type PiCodingAgentModule,
  createDefaultChildSessionFactory,
  loadHostBuiltinExtensions,
} from "../../src/runs/shared/child-session.ts";

interface CapturedLoaderOptions extends Record<string, unknown> {
  extensionFactories?: unknown[];
}

function scriptedPiModule(captured: { loaderOptions?: CapturedLoaderOptions }): PiCodingAgentModule {
  return {
    ModelRuntime: { create: async () => ({ refresh: async () => {} }) },
    SettingsManager: { create: () => ({}) },
    DefaultResourceLoader: class {
      constructor(options: CapturedLoaderOptions) {
        captured.loaderOptions = options;
      }

      async reload() {
        throw new Error("sentinel-stop");
      }
    },
    resolveCliModel: () => ({}),
  } as unknown as PiCodingAgentModule;
}

function baseLaunch(overrides: Partial<ChildSessionLaunch> = {}): ChildSessionLaunch {
  return {
    cwd: process.cwd(),
    storage: { kind: "memory" },
    extensionPaths: [],
    ambientExtensions: false,
    hooks: [],
    noSkills: true,
    noContextFiles: true,
    runtime: {
      fanoutChild: false,
      depth: 1,
      waitTool: { enabled: false },
      fast: false,
    } as ChildSessionLaunch["runtime"],
    ...overrides,
  };
}

describe("loadHostBuiltinExtensions", () => {
  it("reads the host package's built-in extension array", async () => {
    const builtins = await loadHostBuiltinExtensions();
    // The pinned devDep host ships llama.cpp; newer hosts add mcp/codemode/tool-search.
    assert.ok(builtins.length >= 1, "expected at least one host built-in extension");
    assert.ok(
      builtins.every((entry) => typeof entry.name === "string" && typeof entry.factory === "function"),
      "every entry must carry a name and a factory",
    );
  });
});

describe("child loader built-in extension merge", () => {
  it("prepends host built-ins before the launch hooks", async () => {
    const captured: { loaderOptions?: CapturedLoaderOptions } = {};
    const builtin = { name: "builtin:fake", factory: () => {} };
    const hook = { name: "hook", factory: () => {} };
    const factory = createDefaultChildSessionFactory({
      loadPiCodingAgent: async () => scriptedPiModule(captured),
      loadBuiltinExtensions: async () => [builtin],
    });
    await factory.create(baseLaunch({ hooks: [hook] })).catch(() => {});
    assert.deepEqual(captured.loaderOptions?.extensionFactories, [builtin, hook]);
  });

  it("skips host built-in discovery when the pi module itself is injected", async () => {
    const captured: { loaderOptions?: CapturedLoaderOptions } = {};
    const hook = { name: "hook", factory: () => {} };
    const factory = createDefaultChildSessionFactory({
      loadPiCodingAgent: async () => scriptedPiModule(captured),
    });
    await factory.create(baseLaunch({ hooks: [hook] })).catch(() => {});
    assert.deepEqual(captured.loaderOptions?.extensionFactories, [hook]);
  });
});
