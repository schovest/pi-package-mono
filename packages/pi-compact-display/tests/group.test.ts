import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { Container } from "@earendil-works/pi-tui";
import { loadConfig } from '../src/config.ts';
import { GroupContent, groupOf, trackChild, untrackChild, resetChildren, _mirrorDebug } from '../src/group.ts';

vi.mock('fs');

// ── helpers ──

function makeConfig(json: any) {
	vi.mocked(fs.existsSync).mockReturnValue(true);
	vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(json));
	return loadConfig('/test/config.json');
}

/** Fake ToolExecutionComponent (constructor.name ベース判定のため名前を一致させる) */
function makeTool(name: string, args: any, extra: any = {}) {
	return {
		constructor: { name: "ToolExecutionComponent" },
		toolName: name,
		rendererState: {},
		args,
		result: undefined,
		isPartial: false,
		expanded: false,
		...extra,
	};
}

const userMsg = { constructor: { name: "UserMessageComponent" } };
const assistantMsg = { constructor: { name: "AssistantMessageComponent" } };

const theme = {
	bg: (name: string, s: string) => `[${name}]${s}[/${name}]`,
	fg: (name: string, s: string) => `<${name}>${s}</${name}>`,
	bold: (s: string) => `*${s}*`,
};

const resultOf = (text: string, isError = false) => ({
	content: [{ type: "text", text }],
	isError,
});

// ── groupOf ──

describe('groupOf', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('should return empty when grouping is not enabled', () => {
		const config = makeConfig({ bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		trackChild(c, t1);
		expect(groupOf(t1, config)).toEqual([]);
	});

	it('should return empty when owner is not in the tree', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const t1 = makeTool('bash', { command: 'echo a' });
		expect(groupOf(t1, config)).toEqual([]);
	});

	it('should track child safely even when rendererState is undefined', () => {
		const c = new Container();
		const toolWithoutState = { constructor: { name: 'ToolExecutionComponent' }, toolName: 'bash' };
		expect(() => trackChild(c, toolWithoutState)).not.toThrow();
	});

	it('should group consecutive lines tools of the same turn', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const t2 = makeTool('bash', { command: 'echo b' });
		const t3 = makeTool('bash', { command: 'echo c' });
		trackChild(c, t1);
		trackChild(c, t2);
		trackChild(c, t3);
		expect(groupOf(t1, config)).toEqual([t1, t2, t3]);
		expect(groupOf(t2, config)).toEqual([t1, t2, t3]);
		expect(groupOf(t3, config)).toEqual([t1, t2, t3]);
	});

	it('should group different lines tools together', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' }, write: { mode: 'lines' } });
		const c = new Container();
		const b = makeTool('bash', { command: 'echo a' });
		const w = makeTool('write', { path: 'a.txt' });
		trackChild(c, b);
		trackChild(c, w);
		expect(groupOf(b, config)).toEqual([b, w]);
		expect(groupOf(w, config)).toEqual([b, w]);
	});

	it('should break the group at a turn boundary (user message)', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const t2 = makeTool('bash', { command: 'echo b' });
		const t3 = makeTool('bash', { command: 'echo c' });
		trackChild(c, t1);
		trackChild(c, t2);
		trackChild(c, userMsg);
		trackChild(c, t3);
		expect(groupOf(t1, config)).toEqual([t1, t2]);
		expect(groupOf(t3, config)).toEqual([t3]);
	});

	it('should NOT break the group at an assistant message boundary (thinking / model switch)', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const t2 = makeTool('bash', { command: 'echo b' });
		trackChild(c, t1);
		trackChild(c, assistantMsg);
		trackChild(c, t2);
		expect(groupOf(t1, config)).toEqual([t1, t2]);
		expect(groupOf(t2, config)).toEqual([t1, t2]);
	});

	it('should still group across a count_only tool (invisible) within the turn', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' }, read: { mode: 'count_only' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const r = makeTool('read', { path: 'x' });
		const t2 = makeTool('bash', { command: 'echo b' });
		trackChild(c, t1);
		trackChild(c, r);
		trackChild(c, t2);
		expect(groupOf(t1, config)).toEqual([t1, t2]);
	});

	it('should not include default-mode tools in the group', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' }, write: { mode: 'default' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const w = makeTool('write', { path: 'a.txt' });
		trackChild(c, t1);
		trackChild(c, w);
		expect(groupOf(t1, config)).toEqual([t1]);
	});

	it('should exclude a tool with grouping:false from the group', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' }, write: { mode: 'lines', grouping: false } });
		const c = new Container();
		const b = makeTool('bash', { command: 'echo a' });
		const w = makeTool('write', { path: 'a.txt' });
		trackChild(c, b);
		trackChild(c, w);
		// write (grouping:false) はグループメンバーに含まれず、bash は単独グループになる
		expect(groupOf(b, config)).toEqual([b]);
		expect(groupOf(w, config)).not.toContain(w);
	});

	it('should group across a grouping:false tool without including it', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' }, write: { mode: 'lines', grouping: false } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const w = makeTool('write', { path: 'a.txt' });
		const t2 = makeTool('bash', { command: 'echo b' });
		trackChild(c, t1);
		trackChild(c, w);
		trackChild(c, t2);
		expect(groupOf(t1, config)).toEqual([t1, t2]);
		expect(groupOf(t2, config)).toEqual([t1, t2]);
	});

	it('should remove reverse parentMap entries on resetChildren (Q1)', () => {
		const initialSize = _mirrorDebug().parentMapSize;
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const t2 = makeTool('bash', { command: 'echo b' });
		trackChild(c, t1);
		trackChild(c, t2);
		expect(_mirrorDebug().parentMapSize).toBe(initialSize + 2);

		resetChildren(c);
		expect(_mirrorDebug().parentMapSize).toBe(initialSize);

		// クリーン後も再利用可能 (再追加で正しく1件になる)
		trackChild(c, t1);
		expect(_mirrorDebug().parentMapSize).toBe(initialSize + 1);
	});

	it('should not double-count a component re-added to the same container (Q3)', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' }, { result: resultOf('A') });
		trackChild(c, t1);
		trackChild(c, t1); // 同一コンテナへの再追加 (ホストは無条件に再 push する)
		expect(groupOf(t1, config)).toEqual([t1]);

		const gc = new GroupContent(t1, config, theme);
		const text = gc.render(60).join('\n');
		expect(text).toContain('⚡ bash ×1');
		expect(text).not.toContain('⚡ bash ×2');
	});

	it('should update the group after removeChild/resetChildren', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const t2 = makeTool('bash', { command: 'echo b' });
		trackChild(c, t1);
		trackChild(c, t2);
		expect(groupOf(t1, config)).toEqual([t1, t2]);

		untrackChild(c, t2);
		expect(groupOf(t1, config)).toEqual([t1]);

		resetChildren(c);
		expect(groupOf(t1, config)).toEqual([]);
	});

	it('should remove a component from the old container when it is moved to a new container', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c1 = new Container();
		const c2 = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const t2 = makeTool('bash', { command: 'echo b' });

		// c1 に t1, t2 を追加
		trackChild(c1, t1);
		trackChild(c1, t2);
		expect(groupOf(t1, config)).toEqual([t1, t2]);
		expect(groupOf(t2, config)).toEqual([t1, t2]);

		// t2 を c1 → c2 へ移動 (removeChild なしで addChild だけ)
		trackChild(c2, t2);

		// c1 のグループから t2 が除去され、t1 は単独グループになる
		expect(groupOf(t1, config)).toEqual([t1]);
		expect(groupOf(t1, config)).not.toContain(t2);

		// c2 のグループには t2 のみ (c1 由来の残留がない)
		expect(groupOf(t2, config)).toEqual([t2]);
	});
});

// ── GroupContent ──

describe('GroupContent', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('should render only the aggregation header from the leader (no call lines / outputs)', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines', outputLines: 2 } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' }, { result: resultOf('line1\nline2\nline3') });
		const t2 = makeTool('bash', { command: 'echo b' }, { result: resultOf('outB') });
		trackChild(c, t1);
		trackChild(c, t2);

		const gc = new GroupContent(t1, config, theme);
		const text = gc.render(60).join("\n");
		expect(text).toContain('⚡ bash ×2');
		expect(text).not.toContain('$ echo a');
		expect(text).not.toContain('line1');
		expect(text).not.toContain('$ echo b');
		expect(text).not.toContain('outB');
	});

	it('should render nothing for a non-leader member', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' }, { result: resultOf('A') });
		const t2 = makeTool('bash', { command: 'echo b' }, { result: resultOf('B') });
		trackChild(c, t1);
		trackChild(c, t2);

		const gc = new GroupContent(t2, config, theme);
		expect(gc.render(60)).toEqual([]);
	});

	it('should render a singleton with the header ⚡ bash ×1', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo solo' }, { result: resultOf('solo out') });
		trackChild(c, t1);

		const gc = new GroupContent(t1, config, theme);
		const text = gc.render(60).join("\n");
		expect(text).toContain('⚡ bash ×1');
		expect(text).not.toContain('$ echo solo');
		expect(text).not.toContain('solo out');
	});

	it('should use error background when any member errored', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'ok' }, { result: resultOf('ok') });
		const t2 = makeTool('bash', { command: 'bad' }, { result: resultOf('boom', true) });
		trackChild(c, t1);
		trackChild(c, t2);

		const gc = new GroupContent(t1, config, theme);
		const text = gc.render(60).join("\n");
		expect(text).toContain('toolErrorBg');
	});

	it('should use pending background while any member is partial', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'a' }, { isPartial: true, result: undefined });
		trackChild(c, t1);

		const gc = new GroupContent(t1, config, theme);
		const text = gc.render(60).join("\n");
		expect(text).toContain('toolPendingBg');
	});

	it('should expand all members (call lines + full output) when the leader is expanded', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines', outputLines: 2 } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' }, { result: resultOf('l1\nl2\nl3\nl4'), expanded: true });
		const t2 = makeTool('bash', { command: 'echo b' }, { result: resultOf('r1\nr2') });
		trackChild(c, t1);
		trackChild(c, t2);

		const gc = new GroupContent(t1, config, theme);
		const text = gc.render(60).join("\n");
		expect(text).toContain('⚡ bash ×2');
		expect(text).toContain('$ echo a');
		expect(text).toContain('l1');
		expect(text).toContain('l4'); // expanded 時は outputLines を無視して全文
		expect(text).toContain('$ echo b');
		expect(text).toContain('r2');
	});

	it('should render the mcp header and call line with the same base name (Q5)', () => {
		const config = makeConfig({ grouping: true, mcp: { mode: 'lines' } });
		const c = new Container();
		const m1 = makeTool('mcp', {
			tool: 'read',
			args: JSON.stringify({ path: '/etc/hostname' }),
		}, { result: resultOf('a'), expanded: true });
		const m2 = makeTool('mcp', {
			tool: 'read',
			args: JSON.stringify({ path: '/etc/hosts' }),
		}, { result: resultOf('b') });
		trackChild(c, m1);
		trackChild(c, m2);

		const gc = new GroupContent(m1, config, theme);
		const text = gc.render(60).join('\n');
		expect(text).toContain('⚡ mcp:read ×2');
		expect(text).toContain('mcp:read { tool: read, args:');
		expect(text).toContain('{"path":"/etc/hostname"}');
		expect(text).toContain('{"path":"/etc/hosts"}');
	});

	it('should apply each member\'s own noPadding to its output lines when expanded (Q6)', () => {
		const config = makeConfig({
			grouping: true,
			bash: { mode: 'lines' },                 // リーダー: noPadding なし → 空行保持
			edit: { mode: 'lines', noPadding: true }, // メンバー: noPadding → 空行除去
		});
		const c = new Container();
		const b = makeTool('bash', { command: 'x' }, { result: resultOf('b1\n\nb2'), expanded: true });
		const e = makeTool('edit', { path: 'f.txt' }, { result: resultOf('e1\n\ne2') });
		trackChild(c, b);
		trackChild(c, e);

		const gc = new GroupContent(b, config, theme);
		const text = gc.render(60).join('\n');
		// リーダー (noPadding なし) は空行を保持 (<toolOutput></toolOutput> が存在する)
		expect(text).toContain('<toolOutput>b1</toolOutput>');
		expect(text).toContain('<toolOutput></toolOutput>');
		expect(text).toContain('<toolOutput>b2</toolOutput>');
		
		// メンバー (noPadding:true) は空行が除去される
		expect(text).toContain('<toolOutput>e1</toolOutput>');
		expect(text).toContain('<toolOutput>e2</toolOutput>');
		// e1 と e2 の間に空行はない
		const e1Index = text.indexOf('<toolOutput>e1</toolOutput>');
		const e2Index = text.indexOf('<toolOutput>e2</toolOutput>');
		const textBetween = text.substring(e1Index, e2Index);
		expect(textBetween).not.toContain('<toolOutput></toolOutput>');
	});

	it('should show full output for all members when expanded (outputLines ignored)', () => {
		const config = makeConfig({
			grouping: true,
			bash: { mode: 'lines', outputLines: 1 },
			edit: { mode: 'lines', outputLines: 3 },
		});
		const c = new Container();
		const b = makeTool('bash', { command: 'x' }, { result: resultOf('b1\nb2\nb3'), expanded: true });
		const e = makeTool('edit', { path: 'f.txt' }, { result: resultOf('e1\ne2\ne3\ne4') });
		trackChild(c, b);
		trackChild(c, e);

		const gc = new GroupContent(b, config, theme);
		const text = gc.render(60).join("\n");
		expect(text).toContain('b1');
		expect(text).toContain('b3'); // outputLines=1 でも展開時は全文
		expect(text).toContain('e1');
		expect(text).toContain('e4');
	});
});
