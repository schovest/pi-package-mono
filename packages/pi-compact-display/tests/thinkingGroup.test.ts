import fs from "fs";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, MouseRegion, Spacer, Text } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { trackChild } from "../src/group.ts";
import {
  appendGroupWidget,
  extractThinkingTexts,
  isActive,
  resolveTurnGroup,
  setCapturedTheme,
  toggleThinkingGroup,
} from "../src/thinkingGroup.ts";

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

/** Fake AssistantMessageComponent for widget tests — ThinkingGroupWidget が読むフィールド一式 */
function makeWidgetAssistant(content: any[]) {
  return makeAssistant(content, {
    outputPad: 1,
    hiddenThinkingLabel: "Thinking...",
    contentContainer: new Container(),
    updateContent: vi.fn(),
  });
}

/** appendGroupWidget が挿入した MouseRegion の内側 (widget) を取り出す */
function groupWidgetOf(comp: any): { render(width: number): string[]; invalidate(): void } {
  const mr = (comp.contentContainer.children as any[]).find((c) => c instanceof MouseRegion);
  return (mr as any).child;
}

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
  it("should start a new group at an assistant message with visible text (own thinking leads it)", () => {
    const c = new Container();
    const a1 = makeAssistant([thinking("T1")]);
    const tool = makeTool("bash");
    // a2 は lastMessage が上流フィルタ済みでも __piCompactOriginalMessage を優先して読む
    // (退避元メッセージには正文も残る = 可視 text 付き → a2 は新グループの先頭になる)
    const a2 = makeAssistant([textBlock("hi")], {
      __piCompactOriginalMessage: { role: "assistant", content: [thinking("T2"), thinking("T3"), textBlock("hi")] },
    });
    const a3 = makeAssistant([textBlock("no thinking")]);
    trackChild(c, makeUserMsg());
    trackChild(c, a1);
    trackChild(c, tool);
    trackChild(c, a2);
    trackChild(c, a3);

    // a2 自身: a1 とはマージせず、自メッセージから新グループを開始する
    const g = resolveTurnGroup(a2);
    expect(g).toBeDefined();
    expect(g?.leader).toBe(a2);
    expect(g?.members.map((m) => m.comp)).toEqual([a2]);
    expect(g?.members[0]?.texts).toEqual(["T2", "T3"]); // 同一メッセージ内の複数 run も両方計上
    expect(g?.totalRuns).toBe(2);
    // a1 側: a2 の正文で打ち切られる
    const g1 = resolveTurnGroup(a1);
    expect(g1?.leader).toBe(a1);
    expect(g1?.members.map((m) => m.comp)).toEqual([a1]);
    expect(g1?.totalRuns).toBe(1);
  });

  it("should merge thinking of consecutive textless assistant messages in one turn", () => {
    const c = new Container();
    const a1 = makeAssistant([thinking("T1")]);
    const tool = makeTool("bash");
    const a2 = makeAssistant([thinking("T2")]);
    trackChild(c, makeUserMsg());
    trackChild(c, a1);
    trackChild(c, tool);
    trackChild(c, a2);

    // 正文なしの thinking 連鎖は従来通り 1 グループにマージする
    const g = resolveTurnGroup(a2);
    expect(g?.leader).toBe(a1);
    expect(g?.members.map((m) => m.comp)).toEqual([a1, a2]);
    expect(g?.totalRuns).toBe(2);
  });

  it("should split the group at a text-only assistant message", () => {
    const c = new Container();
    const a1 = makeAssistant([thinking("T1")]);
    const answer = makeAssistant([textBlock("answer")]);
    const a2 = makeAssistant([thinking("T2")]);
    trackChild(c, makeUserMsg());
    trackChild(c, a1);
    trackChild(c, answer);
    trackChild(c, a2);

    const g1 = resolveTurnGroup(a1);
    expect(g1?.leader).toBe(a1);
    expect(g1?.members.map((m) => m.comp)).toEqual([a1]);
    const g2 = resolveTurnGroup(a2);
    expect(g2?.leader).toBe(a2);
    expect(g2?.members.map((m) => m.comp)).toEqual([a2]);
  });

  it("should NOT split at whitespace-only assistant text", () => {
    const c = new Container();
    const a1 = makeAssistant([thinking("T1")]);
    const blank = makeAssistant([textBlock("   ")]);
    const a2 = makeAssistant([thinking("T2")]);
    trackChild(c, a1);
    trackChild(c, blank);
    trackChild(c, a2);

    const g = resolveTurnGroup(a2);
    expect(g?.leader).toBe(a1);
    expect(g?.members.map((m) => m.comp)).toEqual([a1, a2]);
  });

  it("should keep a streaming thinking-only message standalone and merge it on completion", () => {
    const c = new Container();
    const a1 = makeAssistant([thinking("T1")]);
    trackChild(c, makeUserMsg());
    trackChild(c, a1);

    // ストリーミング中 (thinking のみ): 動的状態として a1 のグループに含まれず、
    // 自メッセージのみのスタンドアロングループ (最下部の単独エントリ) になる
    const a2 = makeAssistant([thinking("T2")]);
    (a2 as any).__piCompactStreaming = true;
    trackChild(c, a2);
    expect(resolveTurnGroup(a1)?.members.map((m) => m.comp)).toEqual([a1]);
    const g = resolveTurnGroup(a2);
    expect(g?.leader).toBe(a2);
    expect(g?.members.map((m) => m.comp)).toEqual([a2]);

    // 完了 (__piCompactStreaming 解除) → 初めて a1 のグループに合流する
    (a2 as any).__piCompactStreaming = false;
    expect(resolveTurnGroup(a1)?.members.map((m) => m.comp)).toEqual([a1, a2]);
    expect(resolveTurnGroup(a2)?.leader).toBe(a1);
  });

  it("should keep a streaming text-bearing message standalone through completion (no retroactive count change)", () => {
    const c = new Container();
    const a1 = makeAssistant([thinking("T1")]);
    trackChild(c, makeUserMsg());
    trackChild(c, a1);

    const a2 = makeAssistant([thinking("T2")]);
    (a2 as any).__piCompactStreaming = true;
    trackChild(c, a2);
    expect(resolveTurnGroup(a1)?.members.map((m) => m.comp)).toEqual([a1]);

    // ストリーミング中に本文が出ても、動的状態のうちは何も変化しない (×N の後戻りがない)
    (a2 as any).lastMessage = {
      role: "assistant",
      content: [thinking("T2"), textBlock("進捗…")],
      stopReason: "stop",
    };
    expect(resolveTurnGroup(a1)?.members.map((m) => m.comp)).toEqual([a1]);
    expect(resolveTurnGroup(a2)?.leader).toBe(a2);

    // 完了 → 正文付きなので自グループの先頭のまま (立位置は動かない)
    (a2 as any).__piCompactStreaming = false;
    expect(resolveTurnGroup(a2)?.leader).toBe(a2);
    expect(resolveTurnGroup(a2)?.members.map((m) => m.comp)).toEqual([a2]);
    expect(resolveTurnGroup(a1)?.members.map((m) => m.comp)).toEqual([a1]);
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

// ── appendGroupWidget: 挿入位置 ──

describe("appendGroupWidget — insertion", () => {
  beforeAll(() => {
    // プレースホルダーの Markdown 構築にホストテーマが必要 (他テストファイルと同じ初期化)
    initTheme("dark");
  });

  it("should insert the group entry after the leading spacer and preceding text [text, thinking, text]", () => {
    const c = new Container();
    const comp = makeWidgetAssistant([textBlock("a"), thinking("T"), textBlock("b")]);
    // 上流 updateContent (thinking 除去後) が描いた子: 前導 Spacer + 先行 text 1 つ
    const spacer = new Spacer(1);
    const textA = new Text("a-md");
    comp.contentContainer.children.push(spacer, textA);
    trackChild(c, comp);

    appendGroupWidget(comp);

    const kids = comp.contentContainer.children;
    expect(kids).toHaveLength(4);
    expect(kids[0]).toBe(spacer);
    expect(kids[1]).toBe(textA);
    expect(kids[2]).toBeInstanceOf(MouseRegion);
    expect(kids[3]).toBeInstanceOf(Spacer); // 後続 text 前の空行
  });

  it("should prepend the missing leading spacer for a thinking-only message", () => {
    const c = new Container();
    const comp = makeWidgetAssistant([thinking("T")]);
    // thinking 除去後は上流は何も描かない (前導 Spacer もなし)
    trackChild(c, comp);

    appendGroupWidget(comp);

    const kids = comp.contentContainer.children;
    expect(kids).toHaveLength(2);
    expect(kids[0]).toBeInstanceOf(Spacer);
    expect(kids[1]).toBeInstanceOf(MouseRegion);
  });

  it("should insert before trailing text [thinking, text] and keep the trailing spacer", () => {
    const c = new Container();
    const comp = makeWidgetAssistant([thinking("T"), textBlock("hi")]);
    const spacer = new Spacer(1);
    const md = new Markdown("hi", 1, 0, getMarkdownTheme());
    comp.contentContainer.children.push(spacer, md);
    trackChild(c, comp);

    appendGroupWidget(comp);

    const kids = comp.contentContainer.children;
    expect(kids).toHaveLength(4);
    expect(kids[0]).toBe(spacer);
    expect(kids[1]).toBeInstanceOf(MouseRegion);
    expect(kids[2]).toBeInstanceOf(Spacer);
    expect(kids[3]).toBe(md);
  });

  it("should be a no-op for non-leader members and for components outside the mirror", () => {
    const c = new Container();
    const a1 = makeWidgetAssistant([thinking("T1")]);
    const a2 = makeWidgetAssistant([thinking("T2")]);
    trackChild(c, a1);
    trackChild(c, a2);

    // ターン内の第 2 メンバーは挿入しない (描画はリーダーのみ)
    appendGroupWidget(a2);
    expect(a2.contentContainer.children).toHaveLength(0);

    // リーダーは同じ組に対して挿入する
    appendGroupWidget(a1);
    expect(a1.contentContainer.children).toHaveLength(2);

    // ミラー未登録 (グループ無し) も no-op
    const untracked = makeWidgetAssistant([thinking("T")]);
    appendGroupWidget(untracked);
    expect(untracked.contentContainer.children).toHaveLength(0);
  });

  it("should be a no-op while the only thinking block is whitespace (streaming)", () => {
    const c = new Container();
    const comp = makeWidgetAssistant([thinking("   ")]);
    trackChild(c, comp);

    appendGroupWidget(comp);
    expect(comp.contentContainer.children).toHaveLength(0);
  });
});

// ── ThinkingGroupWidget: 描画とトグル ──

describe("ThinkingGroupWidget — render & toggle", () => {
  beforeAll(() => {
    // 展開描画の Markdown フォールバックテーマ (comp.markdownTheme 未携帯) に必要
    initTheme("dark");
  });

  it("should render ×N collapsed label and restyle once a theme is captured", () => {
    const c = new Container();
    const a1 = makeWidgetAssistant([thinking("T1")]);
    const a2 = makeWidgetAssistant([thinking("T2"), thinking("T3")]);
    trackChild(c, a1);
    trackChild(c, a2);
    appendGroupWidget(a1);
    const widget = groupWidgetOf(a1);

    // totalRuns = 3 (跨メンバー + 同一メッセージ内複数 run の合計)
    const plain = widget.render(60).join("\n");
    expect(plain).toContain("Thinking... ×3");

    // totalRuns = 1 は計数を付けない
    const c2 = new Container();
    const solo = makeWidgetAssistant([thinking("solo")]);
    trackChild(c2, solo);
    appendGroupWidget(solo);
    expect(groupWidgetOf(solo).render(60).join("\n")).not.toContain("×");

    // テーマ捕獲後は同一 widget が次フレームで自動再スタイル (Review Focus #3)
    setCapturedTheme({
      fg: (name: string, s: string) => `<${name}>${s}</${name}>`,
      italic: (s: string) => `~${s}~`,
    });
    expect(widget.render(60).join("\n")).toContain("~<thinkingText>Thinking... ×3</thinkingText>~");
  });

  it("should render all member texts when expanded and collapse back on the second toggle", () => {
    const c = new Container();
    const a1 = makeWidgetAssistant([thinking("T1")]);
    const a2 = makeWidgetAssistant([thinking("T2"), thinking("T3")]);
    trackChild(c, a1);
    trackChild(c, a2);
    appendGroupWidget(a1);
    const widget = groupWidgetOf(a1);
    const group = resolveTurnGroup(a1);
    expect(group).toBeDefined();

    toggleThinkingGroup(a1, group!);
    const expanded = widget.render(60).join("\n");
    // 全メンバーの texts が出現順に並ぶ (入力は "\n\n" 接続)
    for (const t of ["T1", "T2", "T3"]) {
      expect(expanded).toContain(t);
    }
    expect(expanded.indexOf("T1")).toBeLessThan(expanded.indexOf("T2"));
    expect(expanded.indexOf("T2")).toBeLessThan(expanded.indexOf("T3"));

    toggleThinkingGroup(a1, group!);
    const collapsed = widget.render(60).join("\n");
    expect(collapsed).toContain("Thinking... ×3");
    expect(collapsed).not.toContain("T2");
  });

  it("should re-render every group member via updateContent(lastMessage) on toggle", () => {
    const c = new Container();
    const a1 = makeWidgetAssistant([thinking("T1")]);
    const a2 = makeWidgetAssistant([thinking("T2")]);
    trackChild(c, a1);
    trackChild(c, a2);
    const group = resolveTurnGroup(a1);
    expect(group).toBeDefined();

    toggleThinkingGroup(a1, group!);

    for (const m of group!.members) {
      expect(m.comp.updateContent).toHaveBeenCalledTimes(1);
      expect(m.comp.updateContent).toHaveBeenCalledWith(m.comp.lastMessage);
    }
  });

  it("should toggle only on left clicks (move/right-click events ignored)", () => {
    const c = new Container();
    const a1 = makeWidgetAssistant([thinking("T1")]);
    const a2 = makeWidgetAssistant([thinking("T2")]);
    trackChild(c, a1);
    trackChild(c, a2);
    appendGroupWidget(a1);
    const mr = (a1.contentContainer.children as any[]).find((ch) => ch instanceof MouseRegion) as MouseRegion;
    const widget = (mr as any).child;

    // MouseRegion はあらゆるマウスイベントを onMouse に流す (上流と同じガードが必要)
    expect(mr.handleMouse({ type: "move", button: "none", x: 0, y: 0 } as any)).toBeUndefined();
    expect(mr.handleMouse({ type: "click", button: "right", x: 0, y: 0 } as any)).toBeUndefined();
    expect(a1.updateContent).not.toHaveBeenCalled();
    expect(a2.updateContent).not.toHaveBeenCalled();
    expect(widget.render(60).join("\n")).toContain("Thinking... ×2"); // まだ折りたたみ

    // 左クリックのみトグル (既存動作)
    const result = mr.handleMouse({ type: "click", button: "left", x: 0, y: 0 } as any);
    expect(result).toEqual({ handled: true });
    expect(a1.updateContent).toHaveBeenCalledTimes(1);
    expect(a2.updateContent).toHaveBeenCalledTimes(1);
    expect(widget.render(60).join("\n")).toContain("T1");
  });

  it("should fall back to singleton-bound mdQuote styling and quote border when no theme was captured", () => {
    // モジュール級キャッシュが先行ケースから漏れている可能性があるため「未捕獲」に戻す
    setCapturedTheme(undefined);
    const c = new Container();
    const a1 = makeWidgetAssistant([thinking("T1")]);
    trackChild(c, a1);
    appendGroupWidget(a1);
    const widget = groupWidgetOf(a1);

    // 収納ラベル: capturedTheme がなくても単例バインドの mdQuote 灰 + 斜体で描く (素テキストに退化しない)
    const collapsed = widget.render(60).join("\n");
    expect(collapsed).toContain("Thinking...");
    expect(collapsed).toMatch(/\u001b\[/); // ANSI スタイルが存在する (mdQuote フォールバック)

    // 展開: 各行に引用ブロック左境界 "│ " が付き、テキストは mdQuote スタイルで描かれる
    const group = resolveTurnGroup(a1);
    expect(group).toBeDefined();
    toggleThinkingGroup(a1, group!);
    const lines = widget.render(60);
    const stripAnsi = (l: string) => l.replace(/\u001b\[[0-9;]*m/g, "");
    const contentLines = lines.filter((l) => stripAnsi(l).includes("T1"));
    expect(contentLines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(stripAnsi(line).startsWith("│ ")).toBe(true); // 無条件の視覚区別 (quoteBorder、空行含む全行)
    }
    expect(lines.join("\n")).toContain("│ ");
  });
});
