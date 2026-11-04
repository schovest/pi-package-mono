import fs from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";

vi.mock("fs");

describe("Event Handlers (Integration)", () => {
  let mockPi: any;
  let handlers: Record<string, Function[]>;

  beforeEach(() => {
    vi.resetAllMocks();
    handlers = {};
    mockPi = {
      on: vi.fn((event: string, handler: Function) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
      }),
      registerToolRenderer: vi.fn(),
    };
  });

  const setupExtension = (configJson: any) => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configJson));
    extension(mockPi);
  };

  const makeTextMessage = (text: string, stopReason: string | undefined) => ({
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason,
  });

  const mockCtx = {
    ui: {
      theme: {
        bg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
      },
    },
  };

  it("should accumulate tool calls and prepend summary to final text response", async () => {
    setupExtension({
      read: { mode: "count_only" },
      grep: { mode: "count_only" },
    });

    // Trigger tool calls
    const toolCallHandler = handlers["tool_call"]?.[0];
    expect(toolCallHandler).toBeDefined();

    await toolCallHandler({ toolCallId: "1", toolName: "read", input: {} });
    await toolCallHandler({ toolCallId: "2", toolName: "read", input: {} });
    await toolCallHandler({ toolCallId: "3", toolName: "grep", input: {} });

    // Trigger message_end for final text-only assistant response
    const messageEndHandler = handlers["message_end"]?.[0];
    expect(messageEndHandler).toBeDefined();

    const result = await messageEndHandler(
      { message: makeTextMessage("This is the final response.", "stop") },
      mockCtx,
    );

    expect(result).toBeDefined();
    expect(result.message.content[0].text).toContain("⚡ read(2) grep(1)");
    expect(result.message.content[0].text).toContain("This is the final response.");
  });

  it("should NOT prepend summary or reset tracker if assistant message is a toolUse stopReason (mid-turn)", async () => {
    setupExtension({
      read: { mode: "count_only" },
    });

    const toolCallHandler = handlers["tool_call"]?.[0];
    await toolCallHandler({ toolCallId: "1", toolName: "read", input: {} });

    const messageEndHandler = handlers["message_end"]?.[0];

    const intermediateMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "I will read the file." },
        { type: "toolCall", id: "1", name: "read", arguments: {} },
      ],
      stopReason: "toolUse",
    };

    const result = await messageEndHandler({ message: intermediateMessage });
    expect(result).toBeUndefined(); // skipped (mid-turn)

    // Now send the final message, the count should still be there!
    const finalResult = await messageEndHandler({ message: makeTextMessage("Done.", "stop") }, mockCtx);
    expect(finalResult).toBeDefined();
    expect(finalResult.message.content[0].text).toContain("⚡ read(1)");
    expect(finalResult.message.content[0].text).toContain("Done.");
  });

  it("should keep the counts on a mid-turn tool-request message with toolCall blocks (stopReason toolUse)", async () => {
    setupExtension({
      read: { mode: "count_only" },
    });

    const toolCallHandler = handlers["tool_call"]?.[0];
    await toolCallHandler({ toolCallId: "1", toolName: "read", input: {} });

    const messageEndHandler = handlers["message_end"]?.[0];

    // 実際の pi フローではツール要求メッセージは stopReason "toolUse" を持つ
    const intermediateMessage = {
      role: "assistant",
      content: [{ type: "toolCall", id: "1", name: "read", arguments: {} }],
      stopReason: "toolUse",
    };

    const result = await messageEndHandler({ message: intermediateMessage });
    expect(result).toBeUndefined(); // skipped (mid-turn)

    // Now send the final message
    const finalResult = await messageEndHandler({ message: makeTextMessage("Done.", "stop") }, mockCtx);
    expect(finalResult).toBeDefined();
    expect(finalResult.message.content[0].text).toContain("⚡ read(1)");
    expect(finalResult.message.content[0].text).toContain("Done.");
  });

  it("should reset the tracker on a terminal message without text blocks (no leak into the next turn)", async () => {
    setupExtension({
      read: { mode: "count_only" },
    });

    const toolCallHandler = handlers["tool_call"]?.[0];
    await toolCallHandler({ toolCallId: "1", toolName: "read", input: {} });

    const messageEndHandler = handlers["message_end"]?.[0];

    // テキストなしの終端メッセージ (stopReason "stop" + 空 content) はサマリーを注入できない
    const emptyMessage = {
      role: "assistant",
      content: [],
      stopReason: "stop",
    };

    const result = await messageEndHandler({ message: emptyMessage });
    expect(result).toBeUndefined();

    // トラッカーは終端でリセット済み → 次のターンの最終メッセージには混入しない
    const finalResult = await messageEndHandler({ message: makeTextMessage("Done.", "stop") }, mockCtx);
    expect(finalResult).toBeUndefined();
  });

  it.each(["error", "aborted", "length", undefined])(
    'should reset the tracker when a turn ends with stopReason "%s" (no leak into the next summary)',
    async (stopReason) => {
      setupExtension({
        read: { mode: "count_only" },
        grep: { mode: "count_only" },
      });

      const toolCallHandler = handlers["tool_call"]?.[0];
      await toolCallHandler({ toolCallId: "1", toolName: "read", input: {} });
      await toolCallHandler({ toolCallId: "2", toolName: "read", input: {} });

      const messageEndHandler = handlers["message_end"]?.[0];

      // ターンが異常終了 (サマリーは注入されない)
      const result = await messageEndHandler({ message: makeTextMessage("something failed", stopReason) }, mockCtx);
      expect(result).toBeUndefined();

      // 次のターンで別ツールを使う → 前ターンの read(2) が混入しない
      await toolCallHandler({ toolCallId: "3", toolName: "grep", input: {} });
      const finalResult = await messageEndHandler({ message: makeTextMessage("Done.", "stop") }, mockCtx);
      expect(finalResult).toBeDefined();
      expect(finalResult.message.content[0].text).toContain("⚡ grep(1)");
      expect(finalResult.message.content[0].text).not.toContain("read");
    },
  );

  it("should not leak the previous turn error flag into the next turn background", async () => {
    setupExtension({
      read: { mode: "count_only" },
      grep: { mode: "count_only" },
    });

    const toolCallHandler = handlers["tool_call"]?.[0];
    const toolResultHandler = handlers["tool_result"]?.[0];
    const messageEndHandler = handlers["message_end"]?.[0];

    // ターン1: read がエラー → ターンは stopReason "error" で終了
    await toolCallHandler({ toolCallId: "1", toolName: "read", input: {} });
    await toolResultHandler({ toolCallId: "1", toolName: "read", input: {}, isError: true });
    await messageEndHandler({ message: makeTextMessage("boom", "error") }, mockCtx);

    // ターン2: 正常な grep → サマリー背景は toolSuccessBg であるべき
    await toolCallHandler({ toolCallId: "2", toolName: "grep", input: {} });
    const finalResult = await messageEndHandler({ message: makeTextMessage("ok", "stop") }, mockCtx);
    expect(finalResult).toBeDefined();
    expect(finalResult.message.content[0].text).toContain("[toolSuccessBg] ⚡ grep(1) ");
    expect(finalResult.message.content[0].text).not.toContain("toolErrorBg");
  });
});
