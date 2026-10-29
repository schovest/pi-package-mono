import { describe, it, expect, vi } from 'vitest';
import { colorizeResult } from '../src/renderUtils.ts';

// renderDiff が例外を投げても表示を壊さず colorizePlain にフォールバックすることを検証する (Q1)。
vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>();
	return {
		...actual,
		renderDiff: () => {
			throw new Error('Theme not initialized. Call initTheme() first.');
		},
	};
});

describe('colorizeResult fallback (Q1)', () => {
	const fakeTheme = {
		fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
	};

	it('should degrade to plain toolOutput coloring when renderDiff throws (Q1)', () => {
		const out = colorizeResult('edit', ' 1 alpha\n-2 bravo\n+2 BRAVO', fakeTheme);
		expect(out).toBe('[toolOutput] 1 alpha[/toolOutput]\n[toolOutput]-2 bravo[/toolOutput]\n[toolOutput]+2 BRAVO[/toolOutput]');
	});
});
