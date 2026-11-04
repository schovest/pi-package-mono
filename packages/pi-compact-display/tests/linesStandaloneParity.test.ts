import fs from "fs";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatCallLine } from "../src/renderUtils.ts";
import { loadRenderingExtension } from "./renderingHarness.ts";

vi.mock("fs");

describe("Standalone vs Grouped Parity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    initTheme("dark");
  });

  const configure = (json: any) => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(json));
    return loadRenderingExtension();
  };

  it("should render the exact same call line in standalone lines mode and grouped expansion", () => {
    const args = { tool: "read", args: JSON.stringify({ path: "/etc/hosts" }) };
    const expected = formatCallLine("mcp", args);
    const makeGrouped = configure({ grouping: true, mcp: { mode: "lines" } });
    const container = new Container();
    const grouped = makeGrouped("mcp", "1", args);
    grouped.updateResult({ content: [{ type: "text", text: "127.0.0.1 localhost" }], isError: false });
    container.addChild(grouped);
    grouped.setExpanded(true);
    expect(grouped.render(120).join("\n")).toContain(expected);
    const makeStandalone = configure({ grouping: false, mcp: { mode: "lines" } });
    const standalone = makeStandalone("mcp", "2", args);
    standalone.updateResult({ content: [{ type: "text", text: "127.0.0.1 localhost" }], isError: false });
    expect(standalone.render(120).join("\n")).toContain(expected);
  });

  it("should respect noPadding setting on standalone lines-mode call line", () => {
    for (const [noPadding, expected] of [
      [false, 1],
      [true, 0],
    ] as const) {
      const makeComponent = configure({ grouping: false, mcp: { mode: "lines", noPadding } });
      const row = makeComponent("mcp", "1", { tool: "search" });
      const renderer = (row as any).getCallRenderer();
      const box = renderer({ tool: "search" }, { fg: () => "", bg: () => "", bold: (s: string) => s }, { state: {} });
      expect(box.paddingX).toBe(expected);
    }
  });
});
