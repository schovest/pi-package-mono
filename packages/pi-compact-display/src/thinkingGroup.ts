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
