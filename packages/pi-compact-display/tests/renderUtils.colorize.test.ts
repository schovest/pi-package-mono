// 移植适配：本文件不引 renderingHarness，vitest 4 逐文件隔离下需自行声明 truecolor（上游由 vitest.config env 提供）。
process.env.COLORTERM ??= "truecolor";

import { initTheme, renderDiff } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";
import { colorizeResult } from "../src/renderUtils.ts";

describe("colorizeResult (diff coloring for edit)", () => {
  const fakeTheme = {
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  };

  beforeEach(() => {
    initTheme("dark");
  });

  it("should colorize - lines and + lines differently for edit tool (S1)", () => {
    const diff = " 1 alpha\n-2 bravo\n+2 BRAVO\n 3 charlie";
    const out = colorizeResult("edit", diff, fakeTheme);
    const lines = out.split("\n");
    expect(lines[1]).toContain("-2 bravo");
    expect(lines[2]).toContain("+2 BRAVO");
    const removeColor = lines[1].match(/\x1b\[38;2;(\d+;\d+;\d+)m/)?.[1];
    const addColor = lines[2].match(/\x1b\[38;2;(\d+;\d+;\d+)m/)?.[1];
    expect(removeColor).toBeDefined();
    expect(addColor).toBeDefined();
    expect(removeColor).not.toBe(addColor);
    expect(out).toBe(renderDiff(diff));
  });

  it("should colorize context lines with context color for edit tool (S2)", () => {
    const diff = " 1 alpha\n-2 bravo\n+2 BRAVO\n 3 charlie";
    const lines = colorizeResult("edit", diff, fakeTheme).split("\n");
    expect(lines[0]).toBe(renderDiff(diff).split("\n")[0]);
  });

  it("should colorize diff with gap lines (...) without crashing (S3)", () => {
    const diff = "   96 Line 96\n   97 Line 97\n-100 old\n+100 new\n  101 Line 101\n     ...\n  104 Line 104";
    const out = colorizeResult("edit", diff, fakeTheme);
    expect(out.split("\n")).toHaveLength(7);
    expect(out).toBe(renderDiff(diff));
  });

  it("should NOT colorize +/- lines for non-edit tools (S4)", () => {
    const text = "+added-like line\n-removed-like line\nnormal line";
    expect(colorizeResult("bash", text, fakeTheme)).toBe(
      "[toolOutput]+added-like line[/toolOutput]\n[toolOutput]-removed-like line[/toolOutput]\n[toolOutput]normal line[/toolOutput]",
    );
  });

  it("should preserve visible text after stripping ANSI (S3)", () => {
    const diff = " 1 alpha\n-2 bravo\n+2 BRAVO\n 3 charlie";
    expect(colorizeResult("edit", diff, fakeTheme).replace(/\x1b\[[0-9;]*m/g, "")).toBe(diff);
  });

  it("should handle empty string without error", () => {
    expect(colorizeResult("edit", "", fakeTheme)).toBe("");
    expect(colorizeResult("bash", "", fakeTheme)).toBe("");
  });
});
