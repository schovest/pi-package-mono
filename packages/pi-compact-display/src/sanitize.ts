/**
 * ツール出力テキストのサニタイズ。
 *
 * ホスト (@earendil-works/pi-coding-agent) は唯一のツールテキストサニタイザとして
 * `getTextOutput` の内部で `sanitizeBinaryOutput(stripAnsi(text)).replace(/\r/g, "")`
 * を使用している (dist/core/tools/render-utils.js)。しかし package.json の exports は
 * "." と "./rpc-entry" のみで深層 import ができないため、同一意味論をローカル実装する。
 *
 * 移植元:
 * - stripAnsi:            dist/utils/ansi.js (ansi-regex / strip-ansi 由来)
 * - sanitizeBinaryOutput: dist/utils/shell.js
 */

/** ansi-regex 由来のパターン (OSC / CSI を除去) */
function ansiRegex(): RegExp {
	// Valid string terminator sequences are BEL, ESC\, and 0x9c
	const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";

	// OSC sequences only: ESC ] ... ST (non-greedy until the first ST)
	const osc = `(?:\\u001B\\][\\s\\S]*?${ST})`;

	// CSI and related: ESC/C1, optional intermediates, optional params (supports ; and :) then final byte
	const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";

	const pattern = `${osc}|${csi}`;
	return new RegExp(pattern, "g");
}

const ANSI_REGEX = ansiRegex();

export function stripAnsi(value: string): string {
	if (typeof value !== "string") {
		throw new TypeError(`Expected a \`string\`, got \`${typeof value}\``);
	}

	// Fast path: ANSI codes require ESC (7-bit) or CSI (8-bit) introducer
	if (!value.includes("\u001B") && !value.includes("\u009B")) {
		return value;
	}
	return value.replace(ANSI_REGEX, "");
}

/**
 * 端末描画 (string-width) を壊すバイトを除去する。
 * - 制御文字 (タブ・改行・CR 以外の 0x00–0x1F)
 * - Unicode フォーマット文字 (U+FFF9–FFFB)
 * - コードポイント未定義の文字
 */
export function sanitizeBinaryOutput(str: string): string {
	return Array.from(str)
		.filter((char) => {
			const code = char.codePointAt(0);

			if (code === undefined) return false;

			// Allow tab, newline, carriage return
			if (code === 0x09 || code === 0x0a || code === 0x0d) return true;

			// Filter out control characters (0x00-0x1F, except 0x09, 0x0a, 0x0d)
			if (code <= 0x1f) return false;

			// Filter out Unicode format characters
			if (code >= 0xfff9 && code <= 0xfffb) return false;

			return true;
		})
		.join("");
}

/**
 * ホストの getTextOutput と同じ順序でツール出力テキストを無害化する。
 * ANSI/OSC-8 シーケンスを除去 → 制御文字を除去 → CR を除去。
 */
export function sanitizeToolText(text: string): string {
	return sanitizeBinaryOutput(stripAnsi(text)).replace(/\r/g, "");
}