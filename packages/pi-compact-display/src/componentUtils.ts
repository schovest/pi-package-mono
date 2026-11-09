/**
 * コンポーネント型判定ユーティリティ。
 * index.ts / group.ts で重複していた判定ロジックをここに集約する。
 * コンストラクタ名で判定する (loader 非依存・ランタイムで型を確認できるため)。
 */

const isName = (c: any, name: string) => c && typeof c === "object" && c.constructor && c.constructor.name === name;

export const isSpacer = (c: object) => isName(c, "Spacer");
export const isUserMessage = (c: object) => isName(c, "UserMessageComponent");
export const isAssistantMessage = (c: object) => isName(c, "AssistantMessageComponent");
export const isToolComp = (c: object) => isName(c, "ToolExecutionComponent");
export const isSkillInvocation = (c: object) => isName(c, "SkillInvocationMessageComponent");

/**
 * コンポーネントの元メッセージを返す。
 * updateContent パッチが thinking 除去前に退避した元メッセージ
 * (__piCompactOriginalMessage) を優先し、なければ宿主が保持する lastMessage。
 * thinkingGroup.ts から移動 (group.ts との循環 import を避ける共有判定の置き場所)。
 */
export function readOriginalMessage(comp: any): any {
  return comp.__piCompactOriginalMessage ?? comp.lastMessage;
}

/** メッセージが可視 text ブロック (trim 後も非空) を持つか。 */
export function hasVisibleText(message: any): boolean {
  return (
    Array.isArray(message?.content) &&
    message.content.some((c: any) => c?.type === "text" && typeof c.text === "string" && c.text.trim() !== "")
  );
}

/**
 * 可視 text を表示する assistant メッセージコンポーネント = グループ区切り。
 * 正常なテキスト出力 (中間報告・最終応答等) でグループを打ち切り、それ以降の
 * thinking / ツール呼び出しは新しいグループになる (コンポーネント自身は新グループの先頭)。
 */
export function isTextBoundary(c: object): boolean {
  return isAssistantMessage(c) && hasVisibleText(readOriginalMessage(c));
}
