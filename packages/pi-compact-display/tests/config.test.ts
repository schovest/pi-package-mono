import fs from "fs";
import { describe, expect, it, vi } from "vitest";
import { getEffectiveToolName, loadConfig, resolveToolConfig } from "../src/config.ts";

vi.mock("fs");

describe("loadConfig", () => {
  it("should return default config if file does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig("/invalid/path.json");
    expect(config.read?.mode).toBe("default");
    expect(config.bash?.mode).toBe("default");
    expect(config.unknownTool?.mode).toBe("default");
  });

  it("should merge parsed config with defaults", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        bash: { mode: "lines", outputLines: 5, noPadding: true },
        read: { mode: "count_only" },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.bash?.mode).toBe("lines");
    expect(config.bash?.outputLines).toBe(5);
    expect(config.bash?.noPadding).toBe(true);
    expect(config.read?.mode).toBe("count_only");

    // 未指定のツールはdefaultになる
    expect(config.write?.mode).toBe("default");
  });

  it('should fall back to "default" key if specified for unconfigured tools', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        default: { mode: "lines", outputLines: 3, noPadding: false },
        read: { mode: "count_only" },
      }),
    );

    const config = loadConfig("/valid/path.json");

    // 個別設定があるツールはそちらを優先
    expect(config.read?.mode).toBe("count_only");

    // 未指定のツールはdefaultキーの設定にフォールバックされる
    expect(config.bash?.mode).toBe("lines");
    expect(config.bash?.outputLines).toBe(3);
    expect(config.bash?.noPadding).toBe(false);
    expect(config.write?.mode).toBe("lines");
  });

  it("should handle symbol and standard object properties safely", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        default: { mode: "lines" },
      }),
    );

    const config = loadConfig("/valid/path.json");

    // symbol properties should not trigger fallback
    const sym = Symbol("test");
    expect((config as any)[sym]).toBeUndefined();

    // toJSON and then should return undefined
    expect((config as any).toJSON).toBeUndefined();
    expect((config as any).then).toBeUndefined();
  });

  it('should support "user" config and not fall back to "default"', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        default: { mode: "lines", noPadding: false },
        user: { noPadding: true },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.user?.noPadding).toBe(true);
  });

  it('should return undefined for "user" if not specified, even if "default" is specified', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        default: { mode: "lines", noPadding: true },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.user).toBeUndefined();
  });

  it('should support the global "grouping" flag', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        grouping: true,
        bash: { mode: "lines", outputLines: 3 },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.grouping).toBe(true);
  });

  it('should return undefined for "grouping" if not specified, even if "default" is specified', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        default: { mode: "lines" },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.grouping).toBeUndefined();
  });

  it('should support the global "hideThinking" flag', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        hideThinking: true,
        bash: { mode: "lines", outputLines: 3 },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.hideThinking).toBe(true);
  });

  it('should return undefined for "hideThinking" if not specified, even if "default" is specified', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        default: { mode: "lines" },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.hideThinking).toBeUndefined();
  });

  it('should return false for "hideThinking" when explicitly set to false (no fallback to "default")', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        hideThinking: false,
        default: { mode: "lines" },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.hideThinking).toBe(false);
  });

  it('should support the global "thinkingGrouping" flag', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        thinkingGrouping: true,
        bash: { mode: "default" },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.thinkingGrouping).toBe(true);
  });

  it('should return undefined for "thinkingGrouping" if not specified, even if "default" is specified', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        default: { mode: "lines" },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.thinkingGrouping).toBeUndefined();
  });

  it('should return false for "thinkingGrouping" when explicitly set to false (no fallback to "default")', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        thinkingGrouping: false,
        default: { mode: "lines" },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.thinkingGrouping).toBe(false);
  });

  it('should support "skill" config and not fall back to "default"', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        default: { mode: "lines", noPadding: false },
        skill: { noPadding: true },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.skill?.noPadding).toBe(true);
  });

  it('should return undefined for "skill" if not specified, even if "default" is specified', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        default: { mode: "lines", noPadding: true },
      }),
    );

    const config = loadConfig("/valid/path.json");
    expect(config.skill).toBeUndefined();
  });
});

describe("getEffectiveToolName", () => {
  it("should return original toolName if args are not provided or not object", () => {
    expect(getEffectiveToolName("bash", null)).toBe("bash");
    expect(getEffectiveToolName("bash", "string")).toBe("bash");
  });

  it("should return prefixed toolName for non-mcp tools with tool or action argument", () => {
    expect(getEffectiveToolName("gateway", { tool: "my_tool" })).toBe("gateway:my_tool");
    expect(getEffectiveToolName("gateway", { action: "my_action" })).toBe("gateway:my_action");
    expect(getEffectiveToolName("gateway", { other: "args" })).toBe("gateway");
  });

  it("should treat mcp with the same generic rule as any other tool (no special case)", () => {
    // tool / action の値のみが接尾辞になる
    expect(getEffectiveToolName("mcp", { action: "run" })).toBe("mcp:run");
    expect(getEffectiveToolName("mcp", { tool: "search" })).toBe("mcp:search");
    // mcp 専用だった引数名は接尾辞を作らない = mcp キーにフォールバックする
    for (const args of [
      { connect: "server" },
      { describe: "tool" },
      { search: "query" },
      { server: "list" },
      { other: "args" },
    ]) {
      expect(getEffectiveToolName("mcp", args)).toBe("mcp");
    }
  });
});

describe("resolveToolConfig", () => {
  it("should fall back to original tool name config if specific is not found", () => {
    const config = {
      bash: { mode: "lines" as const },
      "gateway:my_tool": { mode: "count_only" as const },
    };
    expect(resolveToolConfig("bash", { tool: "other" }, config).mode).toBe("lines");
    expect(resolveToolConfig("gateway", { tool: "my_tool" }, config).mode).toBe("count_only");
  });

  it("should make every displayed count_only name a usable config key (mcp included)", () => {
    // 集計行は getEffectiveToolName の戻り値をそのまま表示するため、
    // その名前がそのまま設定キーとして解決できることを固定する
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        mcp: { mode: "count_only" },
        "mcp:tavily_search": { mode: "lines" },
      }),
    );
    const config = loadConfig("/valid/path.json");

    // 表示名 (= effectiveName) でそのまま引ける
    const eff = getEffectiveToolName("mcp", { tool: "tavily_search" });
    expect(eff).toBe("mcp:tavily_search");
    expect(resolveToolConfig("mcp", { tool: "tavily_search" }, config).mode).toBe("lines");

    // mcp 専用引数名の呼び出しは mcp キーにフォールバックする
    expect(getEffectiveToolName("mcp", { connect: "srv" })).toBe("mcp");
    expect(resolveToolConfig("mcp", { connect: "srv" }, config).mode).toBe("count_only");
  });

  it("should resolve tool config via the sub-tool name pattern", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        "mcp:tavily_tavily_search": { mode: "lines", outputLines: 0, noPadding: true },
        default: { mode: "count_only" },
      }),
    );

    const config = loadConfig("/valid/path.json");

    // MCP gateway call: toolName="mcp", args.tool="tavily_tavily_search"
    const result = resolveToolConfig("mcp", { tool: "tavily_tavily_search", args: "{}" }, config);
    expect(result.mode).toBe("lines");
    expect(result.outputLines).toBe(0);
    expect(result.noPadding).toBe(true);
  });

  it("should fall back to default when no specific key is configured", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        "mcp:tavily_tavily_search": { mode: "lines" },
        default: { mode: "count_only" },
      }),
    );

    const config = loadConfig("/valid/path.json");

    // 非 gateway の引数: mcp キーも無いので default へ
    const result = resolveToolConfig("mcp", { other: "args" }, config);
    expect(result.mode).toBe("count_only"); // falls back to default
  });

  it("should resolve mcp tool config from the mcp:toolname key", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        "mcp:my_tool": { mode: "lines" },
      }),
    );

    const config = loadConfig("/valid/path.json");

    // Direct mcp call pattern
    const result = resolveToolConfig("mcp", { tool: "my_tool" }, config);
    expect(result.mode).toBe("lines");
  });

  it("should resolve namespaced proxy tool config via mcp__<server>:<tool> and mcp__<server> (Q4)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        "mcp__tavily:tavily_search": { mode: "lines", outputLines: 5 },
        mcp__tavily: { mode: "count_only" },
        default: { mode: "default" },
      }),
    );

    const config = loadConfig("/valid/path.json");

    // 1. Tool call with tool argument: toolName="mcp__tavily", args.tool="tavily_search"
    const effWithTool = getEffectiveToolName("mcp__tavily", { tool: "tavily_search" });
    expect(effWithTool).toBe("mcp__tavily:tavily_search");
    const resultWithTool = resolveToolConfig("mcp__tavily", { tool: "tavily_search" }, config);
    expect(resultWithTool.mode).toBe("lines");
    expect(resultWithTool.outputLines).toBe(5);

    // 2. Tool call falling back to server proxy: toolName="mcp__tavily", unconfigured sub-tool
    const effFallback = getEffectiveToolName("mcp__tavily", { tool: "other_tool" });
    expect(effFallback).toBe("mcp__tavily:other_tool");
    const resultFallback = resolveToolConfig("mcp__tavily", { tool: "other_tool" }, config);
    expect(resultFallback.mode).toBe("count_only"); // falls back to mcp__tavily
  });

  it("should ignore retired mcp sub-tool keys and fall back to the general mcp key (Q3)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        "mcp:connect": { mode: "lines" },
        "mcp:describe": { mode: "lines" },
        mcp: { mode: "count_only" },
      }),
    );

    const config = loadConfig("/valid/path.json");

    // args.connect no longer produces mcp:connect, so effectiveName is 'mcp'
    expect(getEffectiveToolName("mcp", { connect: "server" })).toBe("mcp");
    expect(resolveToolConfig("mcp", { connect: "server" }, config).mode).toBe("count_only");

    // args.describe no longer produces mcp:describe, so effectiveName is 'mcp'
    expect(getEffectiveToolName("mcp", { describe: "tool" })).toBe("mcp");
    expect(resolveToolConfig("mcp", { describe: "tool" }, config).mode).toBe("count_only");
  });
});
