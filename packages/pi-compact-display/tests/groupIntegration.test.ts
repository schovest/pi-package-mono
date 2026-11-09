import fs from "fs";
import { AssistantMessageComponent, initTheme, renderDiff } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { groupOf } from "../src/group.ts";
import { loadRenderingExtension } from "./renderingHarness.ts";

vi.mock("fs");

describe("Grouping integration (registered renderers)", () => {
  let makeComponent: ReturnType<typeof loadRenderingExtension>;
  const configure = (config: any) => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    makeComponent = loadRenderingExtension();
  };
  const result = (text: string) => ({ content: [{ type: "text" as const, text }], isError: false });

  beforeEach(() => {
    vi.resetAllMocks();
    initTheme("dark");
    configure({
      grouping: true,
      bash: { mode: "lines", outputLines: 2 },
      read: { mode: "count_only" },
      write: { mode: "lines" },
    });
  });

  it("should render consecutive bash calls as one card from the leader (header only)", () => {
    const c = new Container();
    const a = makeComponent("bash", "1", { command: "echo a" });
    const b = makeComponent("bash", "2", { command: "echo b" });
    a.updateResult(result("A1\nA2\nA3"));
    b.updateResult(result("B1"));
    c.addChild(a);
    c.addChild(b);
    const collapsed = a.render(80).join("\n");
    expect(collapsed).toContain("⚡ bash ×2");
    for (const text of ["$ echo a", "$ echo b", "A1", "B1"]) expect(collapsed).not.toContain(text);
    expect(b.render(80)).toEqual([]);
    a.setExpanded(true);
    const expanded = a.render(80).join("\n");
    for (const text of ["⚡ bash ×2", "$ echo a", "$ echo b", "A1", "A2", "A3", "B1"]) expect(expanded).toContain(text);
  });

  it("should split groups at a user-message boundary", () => {
    const c = new Container();
    const a = makeComponent("bash", "1", { command: "echo a" });
    const b = makeComponent("bash", "2", { command: "echo b" });
    a.updateResult(result("A"));
    b.updateResult(result("B"));
    c.addChild(a);
    c.addChild({ constructor: { name: "UserMessageComponent" } } as any);
    c.addChild(b);
    for (const row of [a, b]) {
      const text = row.render(80).join("\n");
      expect(text).toContain("⚡ bash ×1");
      expect(text).not.toContain("$ echo");
    }
  });

  it("should split groups at an assistant message with visible text", () => {
    const c = new Container();
    const a = makeComponent("bash", "1", { command: "echo a" });
    const b = makeComponent("bash", "2", { command: "echo b" });
    a.updateResult(result("A"));
    b.updateResult(result("B"));
    c.addChild(a);
    c.addChild(
      new AssistantMessageComponent({
        role: "assistant",
        content: [{ type: "text", text: "途中経過" }],
        stopReason: "toolUse",
      } as any),
    );
    c.addChild(b);
    // テキスト出力でグループが分離する: 前後とも単独カウント (×2 にならない)
    expect(a.render(80).join("\n")).toContain("⚡ bash ×1");
    expect(b.render(80).join("\n")).toContain("⚡ bash ×1");
  });

  it("should keep a running tool standalone and fold it into the group on completion", () => {
    const c = new Container();
    const a = makeComponent("bash", "1", { command: "echo a" });
    const b = makeComponent("bash", "2", { command: "echo b" });
    a.updateResult(result("A"));
    c.addChild(a);
    c.addChild(b); // b は実行中 (result 未到着)

    // 実行中の b は動的状態として単独カード ($ コマンド行が見える)、a のカウントに含まれない
    expect(a.render(80).join("\n")).toContain("⚡ bash ×1");
    const running = b.render(80).join("\n");
    expect(running).toContain("$ echo b");
    expect(running).not.toContain("⚡");

    // 完了 → 初めてグループに合流し、b のカードはリーダーに折り畳まれる
    b.updateResult(result("B"));
    expect(a.render(80).join("\n")).toContain("⚡ bash ×2");
    expect(b.render(80).join("\n")).toBe("");
  });

  it("should clear the tracking marker and not track when addChild throws (Q2)", () => {
    const c = new Container();
    const row = makeComponent("bash", "1", { command: "echo a" });
    const original = Container.prototype.addChild;
    Container.prototype.addChild = () => {
      throw new Error("boom");
    };
    try {
      expect(() => c.addChild(row)).toThrow("boom");
      expect((row as any).__piCompactTrackedBy).toBeUndefined();
      expect(groupOf(row, loadConfig("/test/config.json"))).toEqual([]);
    } finally {
      Container.prototype.addChild = original;
    }
  });

  it("should track a component only once when the extension is loaded twice (Q2)", () => {
    makeComponent = loadRenderingExtension();
    const c = new Container();
    const row = makeComponent("bash", "1", { command: "echo a" });
    row.updateResult(result("A"));
    c.addChild(row);
    expect(row.render(80).join("\n")).toContain("⚡ bash ×1");
    expect(groupOf(row, loadConfig("/test/config.json"))).toEqual([row]);
  });

  it("should NOT apply the extension renderer to default-mode tools", () => {
    configure({ fakeTool: { mode: "default", outputLines: 2 }, bash: { mode: "lines" } });
    const normal = makeComponent("fakeTool", "1", {});
    const compact = makeComponent("bash", "2", {});
    expect((normal as any).getRenderShell()).toBe("default");
    expect((normal as any).getResultRenderer()).toBeUndefined();
    expect((compact as any).getRenderShell()).toBe("self");
  });

  it("should render edit diff and write content on group expansion (D-07 / S8)", () => {
    configure({ grouping: true, edit: { mode: "lines" }, write: { mode: "lines" } });
    const c = new Container();
    const edit = makeComponent("edit", "1", { path: "a.ts", edits: [{ oldText: "foo", newText: "bar" }] });
    edit.updateResult({
      ...result("Successfully replaced"),
      details: { diff: " 1 context\n-2 foo\n+2 bar\n 3 context" },
    });
    const write = makeComponent("write", "2", { path: "b.txt", content: "written line 1\nwritten line 2" });
    write.updateResult(result("Successfully wrote"));
    c.addChild(edit);
    c.addChild(write);
    const collapsed = edit.render(80).join("\n");
    expect(collapsed).toContain("⚡ edit ×1 write ×1");
    for (const text of ["Successfully", "foo", "written line"]) expect(collapsed).not.toContain(text);
    edit.setExpanded(true);
    const expanded = edit.render(80).join("\n");
    for (const text of ["edit a.ts", "-2 foo", "+2 bar", "write b.txt", "written line 1", "written line 2"])
      expect(expanded).toContain(text);
    expect(expanded).not.toContain("Successfully");
  });

  it("should colorize edit diff added/removed lines in group expansion (S5)", () => {
    configure({ grouping: true, edit: { mode: "lines" } });
    const c = new Container();
    const edit = makeComponent("edit", "1", { path: "a.ts" });
    edit.updateResult({
      ...result("Successfully replaced"),
      details: { diff: " 1 context\n-2 foo\n+2 bar\n 3 context" },
    });
    c.addChild(edit);
    edit.setExpanded(true);
    const lines = edit.render(80);
    const remove = lines.find((line) => line.includes("-2 foo"));
    const add = lines.find((line) => line.includes("+2 bar"));
    expect(remove).toContain(renderDiff("-2 foo"));
    expect(add).toContain(renderDiff("+2 bar"));
  });
});
