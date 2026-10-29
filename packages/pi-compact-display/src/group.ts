import { Box, Container, Text } from "@earendil-works/pi-tui";
import { Config, getEffectiveToolName, resolveToolConfig } from "./config.ts";
import { formatCallLine, formatOutput, resolveResultText, colorizeResult } from "./renderUtils.ts";
import { isUserMessage, isToolComp } from "./componentUtils.ts";

// ─────────────────────────────────────────────────────────────
// 親子ミラー
//
// pi-tui の Container.addChild は children.push するだけで親参照を持たないため、
// extension 側で addChild / removeChild / clear をパッチしてここにミラーを保守する。
// GroupContent はこのミラーから兄弟の ToolExecutionComponent を探してグループを組む。
// ─────────────────────────────────────────────────────────────

/**
 * WeakMap の size をテストから確認できるようにするラッパー。
 * 本番ロジックの API (get/has/set/delete) は WeakMap と同一。
 */
class TrackedWeakMap<K extends object, V> {
	private readonly map = new WeakMap<K, V>();
	private count = 0;

	has(k: K): boolean {
		return this.map.has(k);
	}

	get(k: K): V | undefined {
		return this.map.get(k);
	}

	set(k: K, v: V): void {
		if (!this.map.has(k)) this.count++;
		this.map.set(k, v);
	}

	delete(k: K): void {
		if (this.map.has(k)) {
			this.map.delete(k);
			this.count--;
		}
	}

	get size(): number {
		return this.count;
	}
}

const parentMap = new TrackedWeakMap<object, Container>();
const childrenMap = new WeakMap<Container, object[]>();
const ownersByState = new WeakMap<object, object>();

export function getGroupOwner(state: object): object | undefined {
	return ownersByState.get(state);
}

/**
 * テスト専用: ミラー状態の内省 (本番コードでは使用しない)。
 * Q1 (resetChildren が逆引き parentMap を残す件) の検証に使う。
 */
export function _mirrorDebug(): { parentMapSize: number } {
	return { parentMapSize: parentMap.size };
}

export function trackChild(container: Container, comp: object): void {
	// Renderer callbacks expose row state, not the row; keep the grouping bridge in the existing mirror.
	if (isToolComp(comp) && (comp as any).rendererState) ownersByState.set((comp as any).rendererState, comp);
	// 同一コンテナへの再追加はミラーに重複登録しない。
	// ホストの Container.addChild は無条件に再 push するため、重複登録すると
	// グループヘッダーのカウント (⚡ bash ×2 等) が水増しされる。
	if (parentMap.get(comp) === container) return;

	// 既に別のコンテナに属している場合は古い親から削除する。
	// コンポーネントが動的に移動された場合 (addChild の再呼び出し)、
	// parentMap を上書きするだけでは古い親の childrenMap に残留し、
	// groupOf が新旧両方のコンテナで当該コンポーネントを発見して二重描画になるため。
	const oldParent = parentMap.get(comp);
	if (oldParent && oldParent !== container) {
		const oldList = childrenMap.get(oldParent);
		if (oldList) {
			const i = oldList.indexOf(comp);
			if (i !== -1) oldList.splice(i, 1);
		}
	}
	parentMap.set(comp, container);
	let list = childrenMap.get(container);
	if (!list) {
		list = [];
		childrenMap.set(container, list);
	}
	list.push(comp);
}

export function untrackChild(container: Container, comp: object): void {
	const list = childrenMap.get(container);
	if (list) {
		const i = list.indexOf(comp);
		if (i !== -1) list.splice(i, 1);
	}
	if (parentMap.get(comp) === container) parentMap.delete(comp);
}

export function resetChildren(container: Container): void {
	const old = childrenMap.get(container);
	if (old) {
		// 逆引き parentMap に残骸を残さない (Container.clear() 後に move 等が
		// 誤って古い親と誤認しないようにするため)。
		for (const c of old) {
			if (parentMap.get(c) === container) parentMap.delete(c);
		}
	}
	childrenMap.set(container, []);
}

// ─────────────────────────────────────────────────────────────
// グループ走査
//
// グループ = 直前のユーザーメッセージ (ターン境界) 以降の lines モード ToolExecutionComponent 全て
// (thinking / モデル切替で assistant メッセージが複数に分かれても1グループ)。
// 先頭メンバー = リーダー。リーダーだけがグループ全体を描画する。
// ─────────────────────────────────────────────────────────────

// ターン境界 = ユーザーメッセージのみ。
// thinking やモデル切替のたびに AssistantMessageComponent が追加されても分割しない
// (pi は 1 ユーザー入力に対し複数の assistant メッセージを生成するため)。
const isTurnBoundary = isUserMessage;

function isGroupMember(c: object, config: Config): boolean {
	if (!isToolComp(c)) return false;
	const anyC = c as any;
	const toolConfig = resolveToolConfig(anyC.toolName, anyC.args, config);
	// ツール個別設定 grouping:false のツールはグループ化から除外して単独表示
	return toolConfig.mode === "lines" && toolConfig.grouping !== false;
}

/**
 * owner が属するグループのメンバーを (呼び出し順で) 返す。
 * grouping 未設定・ツリー未登録・メンバーなしの場合は空配列。
 */
export function groupOf(owner: object, config: Config): any[] {
	if (config.grouping !== true) return [];
	const container = parentMap.get(owner);
	if (!container) return [];
	const cs = childrenMap.get(container) ?? [];
	const ownerIndex = cs.indexOf(owner);
	if (ownerIndex === -1) return [];

	// 後方: 直前のターン境界まで遡り、グループ先頭メンバー (start) を探す
	let start = ownerIndex;
	for (let i = ownerIndex - 1; i >= 0; i--) {
		if (isTurnBoundary(cs[i])) break;
		if (isGroupMember(cs[i], config)) start = i;
	}

	// 前方: 次のターン境界まで全メンバーを収集
	const members: any[] = [];
	for (let i = start; i < cs.length; i++) {
		if (isTurnBoundary(cs[i])) break;
		if (isGroupMember(cs[i], config)) members.push(cs[i]);
	}
	return members;
}

// ─────────────────────────────────────────────────────────────
// GroupContent コンポーネント
//
// リーダーの call renderer が返す動的コンポーネント。毎フレーム render(width) が呼ばれ、
// その時点のミラーとメンバー状態 (result / isPartial / expanded) を生で読んで
// グループ全体を1つのボックスに描画する。
// ─────────────────────────────────────────────────────────────

export class GroupContent {
	private owner: any;
	private config: Config;
	private theme: any;
	private box: Box;
	private text: Text;
	private lastText: string | null = null;

	constructor(owner: any, config: Config, theme: any) {
		this.owner = owner;
		this.config = config;
		this.theme = theme;
		const leaderConfig = resolveToolConfig(owner.toolName, owner.args, config);
		this.text = new Text("", 0, 0);
		// ボックス全体の上部パディングはリーダーの noPadding に従う (仕様)。
		// メンバー個別の noPadding は出力行レベルで formatOutput が空行除去を適用する。
		this.box = new Box(leaderConfig.noPadding ? 0 : 1, 0, (t: string) => theme.bg(this.currentBgName(), t));
		this.box.addChild(this.text);
	}

	private currentBgName(): string {
		const members = groupOf(this.owner, this.config);
		if (members.length === 0) return "toolSuccessBg";
		if (members.some((m) => m.isPartial)) return "toolPendingBg";
		if (members.some((m) => m.result?.isError)) return "toolErrorBg";
		return "toolSuccessBg";
	}

	invalidate(): void {
		this.box.invalidate();
	}

	render(width: number): string[] {
		const members = groupOf(this.owner, this.config);
		// リーダー (先頭メンバー) だけが描画する
		if (members.length === 0 || members[0] !== this.owner) return [];
		const text = this.buildText(members);
		if (text !== this.lastText) {
			this.text.setText(text);
			this.lastText = text;
		}
		return this.box.render(width);
	}

	private buildText(members: any[]): string {
		const theme = this.theme;
		const bold = typeof theme.bold === "function" ? theme.bold : (s: string) => s;
		const expanded = !!this.owner.expanded;
		const lines: string[] = [];

		// 集約ヘッダー (常に表示)
		const counts = new Map<string, number>();
		for (const m of members) {
			const name = getEffectiveToolName(m.toolName, m.args);
			counts.set(name, (counts.get(name) || 0) + 1);
		}
		const header = `⚡ ${[...counts.entries()].map(([n, c]) => `${n} ×${c}`).join(" ")}`;
		lines.push(theme.fg("toolTitle", bold(header)));

		// 展開時のみ: 各呼び出しのコマンド行 + 全出力
		if (expanded) {
			members.forEach((m, idx) => {
				if (idx > 0) lines.push("");
				lines.push(theme.fg("toolTitle", formatCallLine(m.toolName, m.args)));

				const raw = resolveResultText(m.toolName, m.args, m.result);
				if (raw) {
					const mConfig = resolveToolConfig(m.toolName, m.args, this.config);
					const formatted = formatOutput(raw, mConfig, true);
					if (formatted) {
						lines.push(colorizeResult(m.toolName, formatted, theme));
					}
				}
			});
		}

		return lines.join("\n");
	}
}
