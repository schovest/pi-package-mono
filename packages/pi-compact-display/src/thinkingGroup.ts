import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, MouseRegion, Spacer, Text } from "@earendil-works/pi-tui";
import { isAssistantMessage, isTextBoundary, isUserMessage, readOriginalMessage } from "./componentUtils.ts";
import type { Config } from "./config.ts";
import { getContainerChildren } from "./group.ts";

// 元メッセージ読み取りは componentUtils.ts に移動 (API 互換のため再export)。
export { readOriginalMessage };

// ─────────────────────────────────────────────────────────────
// thinking 折りたたみ集約 (thinkingGrouping)
//
// hideThinking + thinkingGrouping 両方が有効なとき、ターン内の thinking ブロックを
// 折りたたみエントリにまとめる。このモジュールは走査・集計のみ (描画ウィジェットは後段)。
// グループの区切りは group.ts と同じく、ユーザーメッセージに加えて可視 text 付き
// assistant メッセージ。thinking / モデル切替で assistant メッセージが複数に分かっても、
// 正文出力がない限り 1 グループにマージする。正文付きメッセージ自身は新グループの
// 先頭になり (その thinking は自メッセージの正文より上に描かれる)、それより下の
// thinking / ツール呼び出しとはマージされない。
//
// 動的と確定の区別: ストリーミング中 (__piCompactStreaming) のメッセージは未確定として
// 常に最下部に単独エントリで表示し、完了時に初めて先行グループへの合流 /
// 正文による新グループ開始が決まる (確定済みグループのカウントは後戻りしない)。
// ─────────────────────────────────────────────────────────────

/** ストリーミング中 (updateContent に isStreaming=true で呼ばれた) assistant メッセージか。 */
const isStreamingAssistant = (c: object) => isAssistantMessage(c) && (c as any).__piCompactStreaming === true;

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
 * owner が属するグループ (区切り間のセグメント) の thinking グループを解決する。
 * ミラー未登録 / owner がツリー外 / thinking を持つメンバー不在なら undefined。
 * leader = 先頭メンバー、totalRuns = 全メンバーの texts.length 合計。
 */
export function resolveTurnGroup(owner: object): ThinkingTurnGroup | undefined {
  const cs = getContainerChildren(owner);
  if (!cs) return undefined;
  const ownerIndex = cs.indexOf(owner);
  if (ownerIndex === -1) return undefined;

  // ストリーミング中の owner は動的状態: 未確定として常に自メッセージのみの
  // スタンドアロングループを返す (最下部の単独エントリ)。
  if (isStreamingAssistant(owner)) {
    const texts = extractThinkingTexts(readOriginalMessage(owner));
    if (texts.length === 0) return undefined;
    return { leader: owner, members: [{ comp: owner, texts }], totalRuns: texts.length };
  }

  // 後方: 直前の境界まで遡る。ユーザーメッセージ (ターン境界, 除外) の直後、
  // ストリーミング中メッセージ (動的, 除外) の直後、または可視 text 付き assistant
  // メッセージ自身 (新グループの先頭に含める) がセグメント先頭。
  let turnStart = 0;
  for (let i = ownerIndex; i >= 0; i--) {
    if (isUserMessage(cs[i])) {
      turnStart = i + 1;
      break;
    }
    if (isStreamingAssistant(cs[i])) {
      turnStart = i + 1;
      break;
    }
    if (isTextBoundary(cs[i])) {
      turnStart = i;
      break;
    }
  }

  // 前方: 次の境界までの完了済み thinking 持ち assistant を収集。
  // ストリーミング中メッセージは動的状態として含めない (完了時に合流判定)。
  // 可視 text 付き assistant はセグメント先頭 (i === turnStart) だけメンバーになり
  // (その thinking は自メッセージの正文より上に描かれる)、それ以降は次グループの
  // 先頭なので収集を打ち切る。
  const members: ThinkingTurnMember[] = [];
  for (let i = turnStart; i < cs.length; i++) {
    const c = cs[i] as any;
    if (isUserMessage(c) || isStreamingAssistant(c)) break;
    if (!isAssistantMessage(c)) continue;
    if (i !== turnStart && isTextBoundary(c)) break;
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
// スタイルはテーマ単例バインドの getMarkdownTheme() (quoteBorder / quote / italic) を基盤とし、
// index.ts が message_start で捕捉した capturedTheme があれば thinkingText (上流 parity) を優先する。
// 捕捉なしでも mdQuote 灰 + 斜体で描く (展開内容は更に引用ブロック左境界で無条件に区別する)。
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

/** getMarkdownTheme() (内部単例バインド、キャプチャ不要) の安全取得。例外時は undefined。 */
function mdTheme(): any {
  try {
    return getMarkdownTheme();
  } catch {
    return undefined;
  }
}

/** 安全调用 markdown 主题函数：闭包在调用时才解析单例（未初始化会抛错）→ undefined。 */
function safeMdStyle(style: ((t: string) => string) | undefined, text: string): string | undefined {
  try {
    return style?.(text);
  } catch {
    return undefined;
  }
}

/** 思考文本的样式: capturedTheme (thinkingText) 优先，无则单例绑定的 mdQuote 灰+斜体，都不可用则纯文本。 */
function styleThinkingText(text: string): string {
  const theme = capturedTheme as any;
  if (theme && typeof theme.fg === "function" && typeof theme.italic === "function") {
    return theme.italic(theme.fg("thinkingText", text));
  }
  const md = mdTheme();
  const quoted = safeMdStyle(md?.quote, text);
  if (quoted === undefined) return text;
  return safeMdStyle(md?.italic, quoted) ?? quoted;
}

/** 引用块左边界：mdQuoteBorder 色的 "│ "（单例绑定，调用时安全解析）；不可用时无色 "│ "。 */
function quoteBorderPrefix(): string {
  return safeMdStyle(mdTheme()?.quoteBorder, "│ ") ?? "│ ";
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
    if (!isExpandedState(this.comp)) return this.collapsedInner(group).render(width);
    // 展開: 上流 blockquote と同じ視覚言語 ("│ " + mdQuoteBorder 色) で無条件に区別する
    const lines = this.expandedInner(group).render(Math.max(1, width - 2));
    const border = quoteBorderPrefix();
    return lines.map((line) => border + line);
  }

  /** 折りたたみ: "Thinking... ×N" (N>=2 のみ計数)。スタイルは styleThinkingText 参照 (単例バインド降級)。 */
  private collapsedInner(group: ThinkingTurnGroup): { render(width: number): string[] } {
    const base = typeof this.comp.hiddenThinkingLabel === "string" ? this.comp.hiddenThinkingLabel : "Thinking...";
    const label = group.totalRuns >= 2 ? `${base} ×${group.totalRuns}` : base;
    return this.cachedInner(
      `c:${styleThinkingText(label)}`,
      () => new Text(styleThinkingText(label), this.comp.outputPad ?? 0, 0),
    );
  }

  /** 展開: 全メンバーの thinking を "\n\n" 接続した 1 つの Markdown で描く。 */
  private expandedInner(group: ThinkingTurnGroup): { render(width: number): string[] } {
    const joined = group.members.flatMap((m) => m.texts).join("\n\n");
    const theme = capturedTheme as any;
    const colorFn =
      theme && typeof theme.fg === "function"
        ? (t: string) => theme.fg("thinkingText", t)
        : (t: string) => safeMdStyle(mdTheme()?.quote, t) ?? t;
    // キーの themeGeneration は capturedTheme 切替検知。length 接頭辞で桁上がり結合の曖昧性を回避。
    return this.cachedInner(
      `e:${themeGeneration}:${joined.length}:${joined}`,
      () =>
        new Markdown(joined, this.comp.outputPad ?? 0, 0, this.comp.markdownTheme ?? getMarkdownTheme(), {
          italic: true,
          color: colorFn,
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
 * appendGroupWidget が挿入したブロック要素 (Spacer / MouseRegion) に付ける目印。
 * 挿入前に旧ブロックを撤去する冪等化に使う。拡張ファクトリが同プロセスで再実行されると
 * (pi-subagents の子 session が ambient extensions を再ロードする等)
 * AssistantMessageComponent.prototype.updateContent は二重に包裹され、内外のパッチが
 * それぞれ appendGroupWidget を呼ぶ。撤去なしの挿入だとウィジェットが 2 個残り
 * 「Thinking... ×N」が 2 行描画されてしまうため、再挿入時に自ブロックを摘み取る。
 */
const WIDGET_BLOCK_MARKER = "__piCompactThinkingGroupBlock";

/**
 * comp の contentContainer から自ブロック (WIDGET_BLOCK_MARKER 印付き) を撤去する。
 * ミラーは addChild 経由でしか観測しないため、直接 splice による撤去はミラーに影響しない。
 */
function removeWidgetBlock(comp: any): void {
  const children = comp.contentContainer?.children;
  if (!Array.isArray(children)) return;
  for (let i = children.length - 1; i >= 0; i--) {
    if ((children[i] as any)?.[WIDGET_BLOCK_MARKER] === true) children.splice(i, 1);
  }
}

/**
 * リーダーコンポーネントの contentContainer に折りたたみエントリを挿入する。
 * 挿入位置は元メッセージ内の最初の thinking ブロック位置から計算する
 * (上流は thinking 除去後に [前導 Spacer, ...可視 text] のみ描くため)。
 * thinking なし / グループなし / 非リーダーは no-op。
 * 冪等: 常に自ブロックを先に撤去してから、リーダー時のみ再挿入する。ストリーミング中は
 * 動的状態として自ウィジェットが最下部に立ち、完了時に非リーダーへ降格する経路があるため、
 * 降格後も自ブロックを残すと撤去済みウィジェットの分だけ Spacer が残って空行になる。
 * 「撤去は無条件、再挿入はリーダー時のみ」が不変条件。これによりネストしたパッチ
 * (拡張ファクトリの同プロセス再実行、pi-subagents 子 session の ambient 再ロード) でも
 * リーダーには常に 1 ブロックしか残らない (生成直後の未 track は no-op、リプレイは
 * customAddChild 側の追い挿入で補う)。
 */
export function appendGroupWidget(comp: any): void {
  const message = readOriginalMessage(comp);
  removeWidgetBlock(comp);
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
  for (const child of block) {
    (child as any)[WIDGET_BLOCK_MARKER] = true;
  }
  children.splice(Math.min(index, children.length), 0, ...block);
}
