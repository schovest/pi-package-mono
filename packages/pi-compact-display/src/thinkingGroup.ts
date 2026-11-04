import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, MouseRegion, Spacer, Text } from "@earendil-works/pi-tui";
import { isAssistantMessage, isUserMessage } from "./componentUtils.ts";
import type { Config } from "./config.ts";
import { getContainerChildren } from "./group.ts";

// ─────────────────────────────────────────────────────────────
// thinking 折りたたみ集約 (thinkingGrouping)
//
// hideThinking + thinkingGrouping 両方が有効なとき、ターン内の全 assistant メッセージの
// thinking ブロックを 1 つの折りたたみエントリにまとめる。このモジュールは走査・集計のみ
// (描画ウィジェットは後段で追加)。ターン境界は group.ts と同じくユーザーメッセージで、
// thinking / モデル切替で assistant メッセージが複数に分かれても 1 ターンとして扱う。
// ─────────────────────────────────────────────────────────────

/** グループメンバー = thinking を持つ assistant メッセージ 1 件分。 */
export interface ThinkingTurnMember {
  comp: any;
  texts: string[];
}

/** 1 ターン分の thinking グループ。leader = 先頭メンバー (描画は leader のみ)。 */
export interface ThinkingTurnGroup {
  leader: any;
  members: ThinkingTurnMember[];
  totalRuns: number;
}

/** 折りたたみ集約モードが有効 (hideThinking:true かつ thinkingGrouping:true) か。 */
export function isActive(config: Config): boolean {
  return config.hideThinking === true && config.thinkingGrouping === true;
}

/** メッセージ内の thinking ブロックのテキスト (trim 後も非空のもの) を出現順に返す。 */
export function extractThinkingTexts(message: any): string[] {
  if (!Array.isArray(message?.content)) return [];
  const texts: string[] = [];
  for (const c of message.content) {
    if (c?.type !== "thinking" || typeof c.thinking !== "string") continue;
    const t = c.thinking.trim();
    if (t) texts.push(t);
  }
  return texts;
}

/**
 * コンポーネントの元メッセージを返す。
 * updateContent パッチが thinking 除去前に退避した元メッセージ
 * (__piCompactOriginalMessage) を優先し、なければ宿主が保持する lastMessage。
 */
export function readOriginalMessage(comp: any): any {
  return comp.__piCompactOriginalMessage ?? comp.lastMessage;
}

/**
 * owner が属するターンの thinking グループを解決する。
 * ミラー未登録 / owner がツリー外 / thinking を持つメンバー不在なら undefined。
 * leader = 先頭メンバー、totalRuns = 全メンバーの texts.length 合計。
 */
export function resolveTurnGroup(owner: object): ThinkingTurnGroup | undefined {
  const cs = getContainerChildren(owner);
  if (!cs) return undefined;
  const ownerIndex = cs.indexOf(owner);
  if (ownerIndex === -1) return undefined;

  // 後方: 直前のユーザーメッセージ (境界, 除外) の直後までがターン先頭
  let turnStart = 0;
  for (let i = ownerIndex - 1; i >= 0; i--) {
    if (isUserMessage(cs[i])) {
      turnStart = i + 1;
      break;
    }
  }

  // 前方: 次のユーザーメッセージ (境界, 除外) までの thinking 持ち assistant を収集
  const members: ThinkingTurnMember[] = [];
  for (let i = turnStart; i < cs.length; i++) {
    if (isUserMessage(cs[i])) break;
    const c = cs[i] as any;
    if (!isAssistantMessage(c)) continue;
    const texts = extractThinkingTexts(readOriginalMessage(c));
    if (texts.length > 0) members.push({ comp: c, texts });
  }
  if (members.length === 0) return undefined;
  const totalRuns = members.reduce((n, m) => n + m.texts.length, 0);
  return { leader: members[0].comp, members, totalRuns };
}

// ─────────────────────────────────────────────────────────────
// ウィジェット描画 (thinkingGrouping)
//
// リーダーの contentContainer に自描画の折りたたみエントリを挿入する。
// ホストテーマは index.ts が message_start で捕捉して setCapturedTheme に渡す。
// 未捕捉時は無色のテキストに降格し、捕獲後の次フレームで自動再スタイルする。
// ─────────────────────────────────────────────────────────────

/** index.ts が捕捉したホストテーマ (fg / italic など)。未捕捉時は null。 */
let capturedTheme: unknown = null;

/**
 * テーマ参照が実際に変化した回数。展開キャッシュのキーに含める — joined が同じでも
 * テーマが変われば色付き Markdown を作り直し、古い colorFn 閉包を使い回さない。
 */
let themeGeneration = 0;

/** index.ts の message_start ハンドラから呼ばれ、ホストテーマをキャッシュする。 */
export function setCapturedTheme(theme: unknown): void {
  if (theme === capturedTheme) return;
  capturedTheme = theme;
  themeGeneration++;
}

/** リーダーコンポーネント → 展開状態。未登録 (既定) は折りたたみ。 */
const expandedMap = new WeakMap<object, boolean>();

function isExpandedState(comp: object): boolean {
  return expandedMap.get(comp) === true;
}

/**
 * 折りたたみエントリの展開状態を反転し、グループ全メンバーを再描画する。
 * 各メンバーの updateContent には元メッセージ (readOriginalMessage) を渡す。
 * index.ts の折りたたみ集約パッチ下では lastMessage は thinking 除去済みのため、
 * これを渡すと contentContainer 再構築でウィジェットが消えてしまう
 * (「元メッセージで再描画」は上流のクリック再描画経路と同じセマンティクス)。
 */
export function toggleThinkingGroup(comp: any, group: ThinkingTurnGroup): void {
  expandedMap.set(comp, !expandedMap.get(comp));
  for (const m of group.members) {
    m.comp.updateContent?.(readOriginalMessage(m.comp));
  }
}

/**
 * 1 ターン分の thinking を 1 エントリで描く動的ウィジェット。
 * 毎フレーム render が呼ばれ、その時点のミラーでグループを解決し直す
 * (ストリーミング中のメンバー追加・計数増加に追従する)。
 * 内側の Text / Markdown は構築キーが変わらない限り作り直さない。
 */
class ThinkingGroupWidget {
  private readonly comp: any;
  private cacheKey: string | null = null;
  private cached: { render(width: number): string[] } | null = null;

  constructor(comp: any) {
    this.comp = comp;
  }

  invalidate(): void {
    this.cacheKey = null;
    this.cached = null;
  }

  render(width: number): string[] {
    const group = resolveTurnGroup(this.comp);
    // グループ解散 (全 thinking が空になった) や非リーダーでは何も描かない
    if (!group || group.leader !== this.comp) return [];
    const inner = isExpandedState(this.comp) ? this.expandedInner(group) : this.collapsedInner(group);
    return inner.render(width);
  }

  /** 折りたたみ: "Thinking... ×N" (N>=2 のみ計数)。テーマ未捕獲時は素のテキスト。 */
  private collapsedInner(group: ThinkingTurnGroup): { render(width: number): string[] } {
    const base = typeof this.comp.hiddenThinkingLabel === "string" ? this.comp.hiddenThinkingLabel : "Thinking...";
    const label = group.totalRuns >= 2 ? `${base} ×${group.totalRuns}` : base;
    const theme = capturedTheme as any;
    let styled = label;
    if (theme) {
      if (typeof theme.fg === "function") styled = theme.fg("thinkingText", styled);
      if (typeof theme.italic === "function") styled = theme.italic(styled);
    }
    return this.cachedInner(`c:${styled}`, () => new Text(styled, this.comp.outputPad ?? 0, 0));
  }

  /** 展開: 全メンバーの thinking を "\n\n" 接続した 1 つの Markdown で描く。 */
  private expandedInner(group: ThinkingTurnGroup): { render(width: number): string[] } {
    const joined = group.members.flatMap((m) => m.texts).join("\n\n");
    const theme = capturedTheme as any;
    const colorFn = theme && typeof theme.fg === "function" ? (t: string) => theme.fg("thinkingText", t) : undefined;
    // キーの themeGeneration はテーマ切替検知、"e:" 直後の "+" はテーマ捕獲の有無 —
    // 未捕獲 → 捕獲の次フレームで色付きに作り直すため
    return this.cachedInner(
      `e:${themeGeneration}${colorFn ? "+" : ""}${joined}`,
      () =>
        new Markdown(joined, this.comp.outputPad ?? 0, 0, this.comp.markdownTheme ?? getMarkdownTheme(), {
          italic: true,
          ...(colorFn ? { color: colorFn } : {}),
        }),
    );
  }

  private cachedInner(
    key: string,
    build: () => { render(width: number): string[] },
  ): {
    render(width: number): string[];
  } {
    if (this.cacheKey !== key || !this.cached) {
      this.cacheKey = key;
      this.cached = build();
    }
    return this.cached;
  }
}

/**
 * リーダーコンポーネントの contentContainer に折りたたみエントリを挿入する。
 * 挿入位置は元メッセージ内の最初の thinking ブロック位置から計算する
 * (上流は thinking 除去後に [前導 Spacer, ...可視 text] のみ描くため)。
 * thinking なし / グループなし / 非リーダーは no-op。
 */
export function appendGroupWidget(comp: any): void {
  const message = readOriginalMessage(comp);
  if (extractThinkingTexts(message).length === 0) return;
  const group = resolveTurnGroup(comp);
  if (!group || group.leader !== comp) return;

  const content: any[] = Array.isArray(message?.content) ? message.content : [];
  const isVisibleText = (c: any) => c?.type === "text" && typeof c.text === "string" && c.text.trim() !== "";
  const firstThinking = content.findIndex((c: any) => c?.type === "thinking");
  const textBefore = content.slice(0, firstThinking).filter(isVisibleText).length;
  const hasTextAfter = content.slice(firstThinking + 1).some(isVisibleText);
  // 先頭の +1 は上流が可視 text を持つメッセージに置く前導 Spacer の分
  const index = (content.some(isVisibleText) ? 1 : 0) + textBefore;

  const block: any[] = [];
  if (index === 0) block.push(new Spacer(1)); // 上流が置かなかった前導 Spacer を補う
  block.push(
    new MouseRegion(new ThinkingGroupWidget(comp), (event: any) => {
      // MouseRegion はあらゆるマウスイベントを onMouse に流す (子に handleMouse が無い場合)。
      // 上流の thinking ラベルと同じく左クリックでのみトグルする (hover での点滅を防ぐ)。
      if (event?.type !== "click" || event?.button !== "left") return undefined;
      const g = resolveTurnGroup(comp);
      if (g) toggleThinkingGroup(comp, g);
      return { handled: true };
    }),
  );
  if (hasTextAfter) block.push(new Spacer(1));

  const children = comp.contentContainer?.children;
  if (!Array.isArray(children)) return;
  children.splice(Math.min(index, children.length), 0, ...block);
}
