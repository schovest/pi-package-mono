// thinkingGrouping 冪等性回归测试。
//
// 背景:pi-subagents の子 session は ambient extensions を同プロセスで再ロードする
// (resetExtensionCacheOnReload → loader.reload() → clearExtensionCache → 拡張ファクトリ再実行)。
// jiti の alias は @earendil-works/pi-coding-agent をホスト同一モジュールへ解決するため、
// AssistantMessageComponent.prototype.updateContent は二重に包裹される。旧実装の
// appendGroupWidget は非冪等 (挿入前に自ブロック撤去なし) だったため、ネストした
// updateContent パッチの内外 2 回の挿入がそのまま残り、リーダーの contentContainer に
// 同一の折りたたみウィジェットが 2 個並び「Thinking... ×N」が 2 行描画されていた。
//
// このファイルは「拡張ファクトリを同プロセスで複数回実行しても、リーダーには
// 折りたたみエントリが 1 個しか現れないこと」を固定する。

import fs from "fs";
import { AssistantMessageComponent, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, MouseRegion } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackChild } from "../src/group.ts";
import extension from "../src/index.ts";
import { appendGroupWidget } from "../src/thinkingGroup.ts";

vi.mock("fs");

// モジュールロード時点の素の updateContent。afterEach で全てのパッチ層を剥がす。
const pristineUpdateContent = AssistantMessageComponent.prototype.updateContent;

const loadExtension = (configJson: any) => {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configJson));
  const mockPi = { on: vi.fn(), registerToolRenderer: vi.fn() };
  extension(mockPi as any);
};

afterEach(() => {
  (AssistantMessageComponent.prototype as any).updateContent = pristineUpdateContent;
  vi.resetAllMocks();
});

const msg = (content: any[]): any => ({ role: "assistant", content, stopReason: "stop" });
const th = (text: string) => ({ type: "thinking", thinking: text });
const tx = (text: string) => ({ type: "text", text: text });

/** チャットツリー全体を描画し、可視の "Thinking..." 行を集める (ホスト TUI の 1 フレーム相当)。 */
function visibleThinkingLines(chat: Container): string[] {
  const lines: string[] = [];
  for (const child of chat.children as any[]) {
    try {
      for (const line of child.render(80) as string[]) {
        const plain = line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]133;[A-C]\x07/g, "");
        if (plain.includes("Thinking")) lines.push(plain.trim());
      }
    } catch {
      // render を持たないフェイクコンポーネントは無視
    }
  }
  return lines;
}

function widgetCount(comp: AssistantMessageComponent): number {
  return ((comp as any).contentContainer.children as any[]).filter((c) => c instanceof MouseRegion).length;
}

// ── ユニット: appendGroupWidget 自体の冪等性 ──

describe("appendGroupWidget idempotency", () => {
  it("should keep exactly one widget block when called repeatedly without a rebuild", () => {
    initTheme("dark");

    const chat = new Container();
    const leader = {
      constructor: { name: "AssistantMessageComponent" },
      lastMessage: msg([th("run 1"), th("run 2"), tx("answer")]),
      outputPad: 1,
      hiddenThinkingLabel: "Thinking...",
      contentContainer: new Container(),
      updateContent: vi.fn(),
    };
    trackChild(chat, { constructor: { name: "UserMessageComponent" } });
    trackChild(chat, leader);

    appendGroupWidget(leader);
    appendGroupWidget(leader);
    appendGroupWidget(leader);

    // MouseRegion (ウィジェット本体) は 1 個のみ
    expect(widgetCount(leader as any)).toBe(1);
    const children = (leader.contentContainer as any).children as any[];
    // 先頭 Spacer + ウィジェットの 2 要素に収束する (Spacer も積み上がらない)
    expect(children).toHaveLength(2);
  });
});

// ── 統合: 拡張ファクトリ再実行 (子 session の ambient 再ロード) ──

describe("extension factory re-execution (nested updateContent patch)", () => {
  const STREAM_CONFIG = { hideThinking: true, thinkingGrouping: true };

  // interactive-mode.js のストリーミング生命周期を映す: message_start → update ×N → end
  function simulateStreamingTurn(chat: Container): AssistantMessageComponent {
    const streaming = new AssistantMessageComponent(undefined, true, getMarkdownTheme(), "Thinking...", 1, []);
    chat.addChild(streaming as any);
    streaming.updateContent(msg([th("r1")]), true);
    const runs = Array.from({ length: 11 }, (_, i) => th(`run ${i + 1}`));
    streaming.updateContent(msg([...runs, tx("still streaming...")]), true);
    streaming.updateContent(msg([...runs, tx("final")]), false);
    return streaming;
  }

  it("should render a single Thinking entry when the factory runs twice (child session reload)", () => {
    initTheme("dark");
    loadExtension(STREAM_CONFIG);
    loadExtension(STREAM_CONFIG); // pi-subagents 子 session による同プロセス再実行

    const chat = new Container();
    chat.addChild({ constructor: { name: "UserMessageComponent" } } as any);
    const streaming = simulateStreamingTurn(chat);

    expect(widgetCount(streaming)).toBe(1);
    expect(visibleThinkingLines(chat)).toHaveLength(1);
  });

  it("should render a single Thinking entry when the factory runs three times", () => {
    initTheme("dark");
    loadExtension(STREAM_CONFIG);
    loadExtension(STREAM_CONFIG);
    loadExtension(STREAM_CONFIG);

    const chat = new Container();
    chat.addChild({ constructor: { name: "UserMessageComponent" } } as any);
    const streaming = simulateStreamingTurn(chat);

    expect(widgetCount(streaming)).toBe(1);
    expect(visibleThinkingLines(chat)).toHaveLength(1);
  });

  it("should render a single Thinking entry per turn across a tool-use turn after double load", () => {
    initTheme("dark");
    loadExtension(STREAM_CONFIG);
    loadExtension(STREAM_CONFIG);

    const chat = new Container();
    chat.addChild({ constructor: { name: "UserMessageComponent" } } as any);

    // assistant A (toolUse で終端) → tool → assistant B (同一ターン)
    const a = new AssistantMessageComponent(undefined, true, getMarkdownTheme(), "Thinking...", 1, []);
    chat.addChild(a as any);
    a.updateContent(msg([th("A think"), tx("calling tool")]), false);

    chat.addChild({ constructor: { name: "ToolExecutionComponent" }, toolName: "bash", rendererState: {} } as any);

    const b = new AssistantMessageComponent(undefined, true, getMarkdownTheme(), "Thinking...", 1, []);
    chat.addChild(b as any);
    b.updateContent(msg([th("B think 1"), th("B think 2"), tx("done")]), false);

    // リーダー (A) にのみウィジェット。B は非リーダーで空描画。
    expect(widgetCount(a)).toBe(1);
    expect(widgetCount(b)).toBe(0);
    expect(visibleThinkingLines(chat)).toHaveLength(1);
  });
});
