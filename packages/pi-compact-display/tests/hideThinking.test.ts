import fs from "fs";
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

vi.mock("fs");

describe("hideThinking — updateContent patch", () => {
  const originalUpdateContent = AssistantMessageComponent.prototype.updateContent;

  afterEach(() => {
    // プロトタイプパッチを元に戻す (テスト間のリーク防止)
    (AssistantMessageComponent.prototype as any).updateContent = originalUpdateContent;
  });

  const loadExtension = (configJson: any) => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configJson));
    const mockPi = {
      on: vi.fn(),
      registerToolRenderer: vi.fn(),
    };
    extension(mockPi as any);
  };

  // 移植适配：partial 消息字面量仅用于组件渲染路径，放宽返回类型以过 strict tsc（类型层修正，运行时不变）。
  const makeMessage = (content: any[]): any => ({
    role: "assistant",
    content,
    stopReason: "stop",
  });

  it("should filter out thinking blocks when hideThinking is true", () => {
    loadExtension({ hideThinking: true });

    const component = new AssistantMessageComponent(
      makeMessage([
        { type: "text", text: "Hello!" },
        { type: "thinking", thinking: "internal reasoning..." },
        { type: "text", text: "World!" },
      ]),
    );

    const lastMessage = (component as any).lastMessage;
    expect(lastMessage).toBeDefined();
    const types = lastMessage.content.map((c: any) => c.type);
    expect(types).toEqual(["text", "text"]);
    expect(types).not.toContain("thinking");
  });

  it("should preserve thinking blocks when hideThinking is not set", () => {
    loadExtension({});

    const component = new AssistantMessageComponent(
      makeMessage([
        { type: "text", text: "Hello!" },
        { type: "thinking", thinking: "internal reasoning..." },
      ]),
    );

    const lastMessage = (component as any).lastMessage;
    expect(lastMessage).toBeDefined();
    const types = lastMessage.content.map((c: any) => c.type);
    expect(types).toEqual(["text", "thinking"]);
  });

  it("should preserve thinking blocks when hideThinking is false", () => {
    loadExtension({ hideThinking: false });

    const component = new AssistantMessageComponent(
      makeMessage([{ type: "thinking", thinking: "internal reasoning..." }]),
    );

    const lastMessage = (component as any).lastMessage;
    expect(lastMessage).toBeDefined();
    expect(lastMessage.content.map((c: any) => c.type)).toEqual(["thinking"]);
  });

  it("should keep text blocks intact when filtering thinking blocks", () => {
    loadExtension({ hideThinking: true });

    const textContent = "A complete text response.";
    const component = new AssistantMessageComponent(
      makeMessage([
        { type: "thinking", thinking: "internal reasoning..." },
        { type: "text", text: textContent },
        { type: "thinking", thinking: "more reasoning..." },
      ]),
    );

    const lastMessage = (component as any).lastMessage;
    expect(lastMessage.content).toHaveLength(1);
    expect(lastMessage.content[0]).toEqual({ type: "text", text: textContent });
  });
});
