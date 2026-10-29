/**
 * コンポーネント型判定ユーティリティ。
 * index.ts / group.ts で重複していた判定ロジックをここに集約する。
 * コンストラクタ名で判定する (loader 非依存・ランタイムで型を確認できるため)。
 */

const isName = (c: any, name: string) =>
	c && typeof c === "object" && c.constructor && c.constructor.name === name;

export const isSpacer = (c: object) => isName(c, "Spacer");
export const isUserMessage = (c: object) => isName(c, "UserMessageComponent");
export const isAssistantMessage = (c: object) => isName(c, "AssistantMessageComponent");
export const isToolComp = (c: object) => isName(c, "ToolExecutionComponent");
export const isSkillInvocation = (c: object) => isName(c, "SkillInvocationMessageComponent");
