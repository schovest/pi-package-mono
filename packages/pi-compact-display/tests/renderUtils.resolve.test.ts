import { describe, it, expect } from 'vitest';
import { resolveResultText } from '../src/renderUtils.ts';

describe('resolveResultText (L1, L2, L3)', () => {
	// ── L2: edit ──
	it('should return details.diff for edit when present and not an error (S1)', () => {
		const result = {
			content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in sample.txt.' }],
			details: {
				diff: ' 1 alpha\n-2 bravo\n+2 BRAVO\n 3 charlie',
				patch: '...',
				firstChangedLine: 2,
			},
		};
		const out = resolveResultText('edit', { path: 'sample.txt' }, result);
		expect(out).toBe(' 1 alpha\n-2 bravo\n+2 BRAVO\n 3 charlie');
	});

	it('should fall back to content for edit when isError is true (S1)', () => {
		const result = {
			content: [{ type: 'text', text: 'Could not find the exact text in sample.txt.' }],
			details: undefined,
			isError: true,
		};
		const out = resolveResultText('edit', { path: 'sample.txt' }, result);
		expect(out).toBe('Could not find the exact text in sample.txt.');
	});

	it('should fall back to content for edit when details.diff is missing (S1)', () => {
		const result = {
			content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in sample.txt.' }],
			details: undefined,
		};
		const out = resolveResultText('edit', { path: 'sample.txt' }, result);
		expect(out).toBe('Successfully replaced 1 block(s) in sample.txt.');
	});

	// ── L3: write ──
	it('should return args.content for write when not an error (S2)', () => {
		const args = { path: 'out.txt', content: 'new line 1\nnew line 2\nnew line 3' };
		const result = {
			content: [{ type: 'text', text: 'Successfully wrote 33 bytes to out.txt' }],
			details: undefined,
		};
		const out = resolveResultText('write', args, result);
		expect(out).toBe('new line 1\nnew line 2\nnew line 3');
	});

	it('should fall back to content for write when isError is true (S2)', () => {
		const args = { path: 'out.txt', content: 'new line 1' };
		const result = {
			content: [{ type: 'text', text: 'EISDIR: illegal operation on a directory' }],
			details: undefined,
			isError: true,
		};
		const out = resolveResultText('write', args, result);
		expect(out).toBe('EISDIR: illegal operation on a directory');
	});

	it('should return empty string for write when args.content is empty string (I3)', () => {
		const args = { path: 'out.txt', content: '' };
		const result = {
			content: [{ type: 'text', text: 'Successfully wrote 0 bytes to out.txt' }],
			details: undefined,
		};
		const out = resolveResultText('write', args, result);
		expect(out).toBe('');
	});

	it('should fall back to content for write when args.content is missing (S2)', () => {
		const result = {
			content: [{ type: 'text', text: 'Successfully wrote 0 bytes' }],
			details: undefined,
		};
		const out = resolveResultText('write', {}, result);
		expect(out).toBe('Successfully wrote 0 bytes');
	});

	// ── L1: multiple text blocks ──
	it('should join ALL text blocks with newlines (S3 / L1)', () => {
		const result = {
			content: [
				{ type: 'text', text: '=== Section 1 ===\nLine A' },
				{ type: 'text', text: '=== Section 2 ===\nLine B' },
				{ type: 'text', text: '=== Section 3 ===\nLine C' },
			],
		};
		const out = resolveResultText('read', { path: 'x' }, result);
		expect(out).toBe('=== Section 1 ===\nLine A\n=== Section 2 ===\nLine B\n=== Section 3 ===\nLine C');
	});

	it('should ignore image blocks and extract text blocks only (S3)', () => {
		const result = {
			content: [
				{ type: 'text', text: 'Read image file [image/png]' },
				{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
			],
		};
		const out = resolveResultText('read', { path: 'tiny.png' }, result);
		expect(out).toBe('Read image file [image/png]');
	});

	it('should return empty string when content has no text blocks', () => {
		const result = {
			content: [
				{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
			],
		};
		const out = resolveResultText('read', { path: 'tiny.png' }, result);
		expect(out).toBe('');
	});

	it('should return empty string when content is empty or undefined', () => {
		expect(resolveResultText('read', {}, { content: [] })).toBe('');
		expect(resolveResultText('read', {}, {})).toBe('');
		expect(resolveResultText('read', {}, null)).toBe('');
	});

	// ── other tools ──
	it('should extract content text for bash/ls/find/grep even if details exist', () => {
		const lsResult = {
			content: [{ type: 'text', text: '.bin/\n.package-lock.json\n@anthropic-ai/' }],
			details: { entryLimitReached: 20 },
		};
		expect(resolveResultText('ls', { path: '.' }, lsResult)).toBe('.bin/\n.package-lock.json\n@anthropic-ai/');

		const bashResult = {
			content: [{ type: 'text', text: 'L1\nL2\nL3' }],
			details: { truncation: { truncated: true } },
		};
		expect(resolveResultText('bash', { command: 'x' }, bashResult)).toBe('L1\nL2\nL3');
	});
});
