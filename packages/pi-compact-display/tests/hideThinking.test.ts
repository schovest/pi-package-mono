import fs from "fs";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, MouseRegion, Spacer } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.ts";
import { setCapturedTheme } from "../src/thinkingGroup.ts";

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

describe("thinkingGrouping — updateContent wiring", () => {
  const originalUpdateContent = AssistantMessageComponent.prototype.updateContent;

  afterEach(() => {
    // プロトタイプパッチを元に戻す (テスト間のリーク防止)
    (AssistantMessageComponent.prototype as any).updateContent = originalUpdateContent;
    // thinkingGroup.ts のモジュール級 theme キャッシュも戻す (case 7 が stub を書き込むため)
    setCapturedTheme(undefined);
  });

  const loadExtension = (configJson: any) => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configJson));
    const mockPi = {
      on: vi.fn(),
      registerToolRenderer: vi.fn(),
    };
    extension(mockPi as any);
    return mockPi;
  };

  const makeMessage = (content: any[]): any => ({
    role: "assistant",
    content,
    stopReason: "stop",
  });
  const thinking = (text: string) => ({ type: "thinking", thinking: text });
  const textBlock = (text: string) => ({ type: "text", text });

  // ホストの message_start と同じ順序: 生成 → chatContainer.addChild (ミラー登録) → updateContent。
  // 生成直後 (ミラー未登録) は appendGroupWidget が no-op になるため、track 後の再描画で挿入される。
  const mountAssistant = (container: Container, message: any) => {
    const comp = new AssistantMessageComponent(message);
    container.addChild(comp);
    comp.updateContent(message);
    return comp;
  };

  // appendGroupWidget が挿入した折りたたみウィジェット (ThinkingGroupWidget) を数える。
  // 上流自身の thinking ラベルも MouseRegion なので child の型で区別する。
  // (contentContainer は d.ts 上 private のため any 経由で読む — 本番ロジックは public な挙動)
  const contentKids = (comp: AssistantMessageComponent): any[] => (comp as any).contentContainer?.children ?? [];
  const groupWidgetRegions = (comp: AssistantMessageComponent) =>
    contentKids(comp).filter(
      (c) => c instanceof MouseRegion && (c as any).child?.constructor?.name === "ThinkingGroupWidget",
    );

  it("should filter thinking from lastMessage and stash the original when both flags are on", () => {
    loadExtension({ hideThinking: true, thinkingGrouping: true });

    const message = makeMessage([thinking("T"), textBlock("hi")]);
    const comp = new AssistantMessageComponent(message);

    // lastMessage は純粋 hideThinking と同じく thinking 除去済み
    const types = (comp as any).lastMessage.content.map((c: any) => c.type);
    expect(types).toEqual(["text"]);
    // 元メッセージは thinking 除去前に退避される (thinkingGroup.ts の読み取り元)
    expect((comp as any).__piCompactOriginalMessage).toBe(message);

    // thinking なしでは退避しない
    const plain = new AssistantMessageComponent(makeMessage([textBlock("hi")]));
    expect((plain as any).__piCompactOriginalMessage).toBeUndefined();
  });

  it("should insert the group widget on the leader once the mirror is in place", () => {
    loadExtension({ hideThinking: true, thinkingGrouping: true });

    const container = new Container();
    const message = makeMessage([thinking("T1")]);
    const comp = new AssistantMessageComponent(message);
    // 生成直後 (ミラー未登録) は挿入されない
    expect(contentKids(comp)).toHaveLength(0);

    container.addChild(comp);
    comp.updateContent(message);

    expect(groupWidgetRegions(comp)).toHaveLength(1);
    expect(contentKids(comp).some((c: any) => c instanceof MouseRegion)).toBe(true);
  });

  it("should not insert the widget on non-leader members (text still renders)", () => {
    loadExtension({ hideThinking: true, thinkingGrouping: true });

    const container = new Container();
    const leader = mountAssistant(container, makeMessage([thinking("T1")]));
    const member = mountAssistant(container, makeMessage([thinking("T2"), textBlock("hi")]));

    // 描画はリーダーのみ。メンバーは thinking 除去後の text を普通に描く
    expect(groupWidgetRegions(member)).toHaveLength(0);
    expect(contentKids(member).filter((c: any) => c instanceof Markdown)).toHaveLength(1);
    expect(contentKids(member).some((c: any) => c instanceof MouseRegion)).toBe(false);
    expect(groupWidgetRegions(leader)).toHaveLength(1);
  });

  it("should order children [Spacer, MouseRegion, Spacer, Markdown] for [thinking, text]", () => {
    loadExtension({ hideThinking: true, thinkingGrouping: true });

    const container = new Container();
    const comp = mountAssistant(container, makeMessage([thinking("T"), textBlock("hi")]));

    const kids = contentKids(comp);
    expect(kids).toHaveLength(4);
    expect(kids[0]).toBeInstanceOf(Spacer);
    expect(kids[1]).toBeInstanceOf(MouseRegion); // ウィジェットは text (Markdown) の前
    expect(kids[2]).toBeInstanceOf(Spacer);
    expect(kids[3]).toBeInstanceOf(Markdown);
  });

  it("should stay inactive when only one flag is set (passthrough / pure hide)", () => {
    // thinkingGrouping 単独: 素通し — thinking は lastMessage に残り、ウィジェット無し
    loadExtension({ thinkingGrouping: true });
    const containerA = new Container();
    const compA = mountAssistant(containerA, makeMessage([thinking("T"), textBlock("hi")]));
    expect((compA as any).lastMessage.content.map((c: any) => c.type)).toEqual(["thinking", "text"]);
    expect((compA as any).__piCompactOriginalMessage).toBeUndefined();
    expect(groupWidgetRegions(compA)).toHaveLength(0);
    // 上流自身の thinking 描画 (Markdown in MouseRegion) はそのまま残る
    const upstream = contentKids(compA).filter((c: any) => c instanceof MouseRegion);
    expect(upstream).toHaveLength(1);
    expect((upstream[0] as any).child).toBeInstanceOf(Markdown);

    // hideThinking 単独: 従来の純粋隠蔽 — lastMessage から除去、MouseRegion 無し
    loadExtension({ hideThinking: true });
    const compB = new AssistantMessageComponent(makeMessage([thinking("T"), textBlock("hi")]));
    expect((compB as any).lastMessage.content.map((c: any) => c.type)).toEqual(["text"]);
    expect(contentKids(compB).some((c: any) => c instanceof MouseRegion)).toBe(false);
  });

  it("should use the host hiddenThinkingLabel as the collapsed label base", () => {
    loadExtension({ hideThinking: true, thinkingGrouping: true });

    const container = new Container();
    const comp = mountAssistant(container, makeMessage([thinking("T")]));
    (comp as any).hiddenThinkingLabel = "思考中…";

    const region = groupWidgetRegions(comp)[0];
    expect(region).toBeDefined();
    const rendered = ((region as any).child as { render(width: number): string[] }).render(60).join("\n");
    expect(rendered).toContain("思考中…");
    expect(rendered).not.toContain("Thinking...");
  });

  it("should capture the host theme via the message_start handler and style the label", async () => {
    const mockPi = loadExtension({ hideThinking: true, thinkingGrouping: true });
    const registered = mockPi.on.mock.calls.filter((c: any[]) => c[0] === "message_start");
    expect(registered).toHaveLength(1);
    const handler = registered[0][1] as any;

    // ctx.ui.theme が無くても投げない (headless)
    await expect(handler({}, undefined)).resolves.toBeUndefined();
    await expect(handler({}, {})).resolves.toBeUndefined();

    const stubTheme = {
      fg: (name: string, s: string) => `<${name}>${s}</${name}>`,
      italic: (s: string) => `~${s}~`,
    };
    await handler({}, { ui: { theme: stubTheme } });

    const container = new Container();
    const comp = mountAssistant(container, makeMessage([thinking("T1")]));
    const region = groupWidgetRegions(comp)[0];
    expect(region).toBeDefined();
    const rendered = ((region as any).child as { render(width: number): string[] }).render(60).join("\n");
    expect(rendered).toContain("~<thinkingText>Thinking...</thinkingText>~");
  });

  it("should insert the widget when the component is attached after construction (replay path)", () => {
    loadExtension({ hideThinking: true, thinkingGrouping: true });

    const container = new Container();
    const message = makeMessage([thinking("T1")]);
    // ホストのリプレイ経路 (interactive-mode): コンストラクタが updateContent を呼ぶのは
    // addChild より前 (ミラー未登録 = 挿入 no-op)。その後 addChild するだけで再 updateContent は無い。
    const comp = new AssistantMessageComponent(message);
    expect(groupWidgetRegions(comp)).toHaveLength(0); // 未接続では挿入されない

    container.addChild(comp);

    expect(groupWidgetRegions(comp)).toHaveLength(1);
  });

  it("should keep the widget across host redraws (invalidate / setHiddenThinkingLabel)", () => {
    loadExtension({ hideThinking: true, thinkingGrouping: true });

    const container = new Container();
    const leader = mountAssistant(container, makeMessage([thinking("T1"), textBlock("hi")]));
    expect(groupWidgetRegions(leader)).toHaveLength(1);

    // invalidate() は thinking 除去済みの lastMessage で contentContainer を作り直す —
    // 消えずに同じ位置へ再挿入されること
    (leader as any).invalidate();
    expect(groupWidgetRegions(leader)).toHaveLength(1);
    const kids = contentKids(leader);
    expect(kids[1]).toBeInstanceOf(MouseRegion);

    // ホストの thinking ラベル変更経路 (setHiddenThinkingLabel → updateContent) でも消えない
    (leader as any).setHiddenThinkingLabel("Thinking (hidden)…");
    expect(groupWidgetRegions(leader)).toHaveLength(1);
  });

  it("should rebuild expanded rendering with the new theme after a theme change", async () => {
    // 展開 Markdown の構築にホストテーマが必要 (他の real wiring ケースと同じ初期化)
    initTheme("dark");
    const mockPi = loadExtension({ hideThinking: true, thinkingGrouping: true });
    const registered = mockPi.on.mock.calls.filter((c: any[]) => c[0] === "message_start");
    const handler = registered[0][1] as any;
    const mkTheme = (tag: string) => ({
      fg: (name: string, s: string) => `<${tag}:${name}>${s}</${tag}:${name}>`,
      italic: (s: string) => `~${s}~`,
    });

    await handler({}, { ui: { theme: mkTheme("A") } });
    const container = new Container();
    const leader = mountAssistant(container, makeMessage([thinking("T1")]));
    const region = groupWidgetRegions(leader)[0];
    expect(region).toBeDefined();

    // 左クリックで展開 — theme A の colorFn でキャッシュが作られる
    (region as any).handleMouse({ type: "click", button: "left", x: 0, y: 0 } as any);
    const renderExpanded = () =>
      ((groupWidgetRegions(leader)[0] as any).child as { render(width: number): string[] }).render(60).join("\n");
    expect(renderExpanded()).toContain("<A:thinkingText>");

    // テーマ切替 (message_start で捕捉) — joined が不変でも新 colorFn で作り直す
    await handler({}, { ui: { theme: mkTheme("B") } });
    const withB = renderExpanded();
    expect(withB).toContain("<B:thinkingText>");
    expect(withB).not.toContain("<A:thinkingText>");
  });

  it("should rebuild the widget from the original message on toggle click (real wiring)", () => {
    // 展開描画の Markdown 構築にホストテーマが必要 (thinkingGroup.test.ts と同じ初期化)
    initTheme("dark");
    loadExtension({ hideThinking: true, thinkingGrouping: true });

    const container = new Container();
    const leader = mountAssistant(container, makeMessage([thinking("T1")]));
    mountAssistant(container, makeMessage([thinking("T2")]));

    const region = groupWidgetRegions(leader)[0];
    expect(region).toBeDefined();

    // 左クリックで展開 — ウィジェットは消えず、全メンバーの thinking が描かれる
    const first = (region as any).handleMouse({ type: "click", button: "left", x: 0, y: 0 } as any);
    expect(first).toEqual({ handled: true });
    const expandedRegion = groupWidgetRegions(leader)[0];
    expect(expandedRegion).toBeDefined();
    const expanded = ((expandedRegion as any).child as { render(width: number): string[] }).render(60).join("\n");
    expect(expanded).toContain("T1");
    expect(expanded).toContain("T2");

    // 再クリックで折りたたみラベルに戻る (計数 = 全メンバーの run 合計)
    (expandedRegion as any).handleMouse({ type: "click", button: "left", x: 0, y: 0 } as any);
    const collapsedRegion = groupWidgetRegions(leader)[0];
    expect(collapsedRegion).toBeDefined();
    const collapsed = ((collapsedRegion as any).child as { render(width: number): string[] }).render(60).join("\n");
    expect(collapsed).toContain("Thinking... ×2");
    expect(collapsed).not.toContain("T1");
  });
});
