/**
 * pi-tui 降级兼容层（目标环境 @earendil-works/pi-tui 0.80.5）。
 *
 * `stripTerminalSequences` 是 pi-tui 0.84+ 才新增的导出，旧版（0.80.5 及
 * schovest fork）缺失，直接命名导入会得到 undefined，导致 goal_complete 等
 * 通知路径崩溃（`stripTerminalSequences is not a function`）。
 *
 * 这里用命名空间导入（命名空间缺导出不会抛错）+ 运行时探测：新环境用官方
 * 实现，旧环境回退到本地等价实现（逻辑与上游 utils.ts 的 extractAnsiCode /
 * stripTerminalSequences 一致，剥离 CSI/OSC/APC 换码序列，保留可见文本）。
 */

import * as PiTui from "@earendil-works/pi-tui";

interface AnsiCode {
  code: string;
  length: number;
}

/** 与上游 pi-tui 0.84 extractAnsiCode 行为一致的本地实现。 */
export function extractAnsiCode(str: string, pos: number): AnsiCode | null {
  if (pos >= str.length || str[pos] !== "\x1b") return null;
  const next = str[pos + 1];
  // CSI sequence: ESC [ ... m/G/K/H/J
  if (next === "[") {
    let j = pos + 2;
    while (j < str.length && !/[mGKHJ]/.test(str[j])) j++;
    if (j < str.length) return { code: str.substring(pos, j + 1), length: j + 1 - pos };
    return null;
  }
  // OSC sequence (ESC ] ... BEL 或 ESC ] ... ST) 与 APC sequence (ESC _ ...)：
  // 超链接 (OSC 8)、窗口标题、光标标记等。
  if (next === "]" || next === "_") {
    let j = pos + 2;
    while (j < str.length) {
      if (str[j] === "\x07") return { code: str.substring(pos, j + 1), length: j + 1 - pos };
      if (str[j] === "\x1b" && str[j + 1] === "\\") {
        return { code: str.substring(pos, j + 2), length: j + 2 - pos };
      }
      j++;
    }
    return null;
  }
  return null;
}

/** 与上游 pi-tui 0.84 stripTerminalSequences 行为一致的本地实现。 */
export function fallbackStripTerminalSequences(str: string): string {
  if (!str.includes("\x1b")) return str;
  let result = "";
  let i = 0;
  while (i < str.length) {
    const ansi = extractAnsiCode(str, i);
    if (ansi) {
      i += ansi.length;
      continue;
    }
    result += str[i];
    i++;
  }
  return result;
}

export const stripTerminalSequences: (str: string) => string =
  (PiTui as unknown as { stripTerminalSequences?: (str: string) => string }).stripTerminalSequences ??
  fallbackStripTerminalSequences;
