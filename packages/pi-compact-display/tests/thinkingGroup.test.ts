import fs from "fs";
import { Container } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { trackChild } from "../src/group.ts";
import { extractThinkingTexts, isActive, resolveTurnGroup } from "../src/thinkingGroup.ts";

vi.mock("fs");

// ── helpers ──

function makeConfig(json: any) {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(json));
  return loadConfig("/test/config.json");
}

/** Fake AssistantMessageComponent (constructor.name ベース判定のため名前を一致させる) */
function makeAssistant(content: any[], extra: any = {}) {
  return {
    constructor: { name: "AssistantMessageComponent" },
    lastMessage: { role: "assistant", content, stopReason: "stop" },
    ...extra,
  };
}

/** Fake UserMessageComponent (ターン境界)。都度新規インスタンス (同一物を 2 回 track しない)。 */
const makeUserMsg = () => ({ constructor: { name: "UserMessageComponent" } });

/** Fake ToolExecutionComponent (走査上の非メンバー要素) */
function makeTool(name: string) {
  return {
    constructor: { name: "ToolExecutionComponent" },
    toolName: name,
    rendererState: {},
    args: {},
    result: undefined,
    isPartial: false,
    expanded: false,
  };
}

const thinking = (text: string) => ({ type: "thinking", thinking: text });
const textBlock = (text: string) => ({ type: "text", text });

// ── isActive ──

describe("isActive", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should be true only when both hideThinking and thinkingGrouping are true", () => {
    expect(isActive(makeConfig({ hideThinking: true, thinkingGrouping: true }))).toBe(true);
    // 片方の欠落・明示的 false・両方未設定は無効
    expect(isActive(makeConfig({ thinkingGrouping: true }))).toBe(false);
    expect(isActive(makeConfig({ hideThinking: true }))).toBe(false);
    expect(isActive(makeConfig({ hideThinking: false, thinkingGrouping: true }))).toBe(false);
    expect(isActive(makeConfig({ hideThinking: true, thinkingGrouping: false }))).toBe(false);
    expect(isActive(makeConfig({}))).toBe(false);
  });
});

// ── extractThinkingTexts ──

describe("extractThinkingTexts", () => {
  it("should skip non-thinking and whitespace-only blocks and keep order", () => {
    const message = {
      content: [thinking("  first  "), textBlock("answer"), thinking("second"), thinking("   "), thinking("")],
    };
    expect(extractThinkingTexts(message)).toEqual(["first", "second"]);
    // thinking ブロックなし / content 非配列は安全に空配列
    expect(extractThinkingTexts({ content: [textBlock("only text")] })).toEqual([]);
    expect(extractThinkingTexts({})).toEqual([]);
  });
});

// ── resolveTurnGroup ──

describe("resolveTurnGroup", () => {
  it("should aggregate thinking runs across assistant messages of the same turn", () => {
    const c = new Container();
    const a1 = makeAssistant([thinking("T1")]);
    const tool = makeTool("bash");
    // a2 は lastMessage が上流フィルタ済みでも __piCompactOriginalMessage を優先して読む
    const a2 = makeAssistant([textBlock("hi")], {
      __piCompactOriginalMessage: { role: "assistant", content: [thinking("T2"), thinking("T3")] },
    });
    const a3 = makeAssistant([textBlock("no thinking")]);
    trackChild(c, makeUserMsg());
    trackChild(c, a1);
    trackChild(c, tool);
    trackChild(c, a2);
    trackChild(c, a3);

    const g = resolveTurnGroup(a2);
    expect(g).toBeDefined();
    expect(g?.leader).toBe(a1);
    expect(g?.members.map((m) => m.comp)).toEqual([a1, a2]);
    expect(g?.members[0]?.texts).toEqual(["T1"]);
    expect(g?.members[1]?.texts).toEqual(["T2", "T3"]); // 同一メッセージ内の複数 run も両方計上
    expect(g?.totalRuns).toBe(3);
  });

  it("should start a new turn at a user message (previous turn excluded)", () => {
    const c = new Container();
    const a1 = makeAssistant([thinking("T1")]);
    const a2 = makeAssistant([thinking("T2")]);
    trackChild(c, makeUserMsg());
    trackChild(c, a1);
    trackChild(c, makeUserMsg());
    trackChild(c, a2);

    const g = resolveTurnGroup(a2);
    expect(g?.leader).toBe(a2);
    expect(g?.members.map((m) => m.comp)).toEqual([a2]);
    expect(g?.totalRuns).toBe(1);
  });

  it("should return undefined when the owner is not tracked in the mirror", () => {
    const a1 = makeAssistant([thinking("T1")]);
    expect(resolveTurnGroup(a1)).toBeUndefined();
  });

  it("should not include whitespace-only thinking messages in the group", () => {
    const c = new Container();
    const a1 = makeAssistant([thinking("   ")]);
    const a2 = makeAssistant([thinking("T2")]);
    trackChild(c, a1);
    trackChild(c, a2);

    const g = resolveTurnGroup(a2);
    expect(g?.leader).toBe(a2);
    expect(g?.members.map((m) => m.comp)).toEqual([a2]);
    expect(g?.totalRuns).toBe(1);
  });
});
