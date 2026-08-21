/**
 * 降级兼容测试：pi-tui 0.80.5 无 stripTerminalSequences 导出（0.84+ 才有），
 * 本包必须能在旧版环境正常调用 goal_complete 的通知路径。
 *
 * 回归背景：`(0, _piTui.stripTerminalSequences) is not a function` —
 * 上游直接命名导入缺失导出，旧版运行时得到 undefined。
 */

import assert from "node:assert/strict";
import { test } from "vitest";
import { extractAnsiCode, fallbackStripTerminalSequences, stripTerminalSequences } from "../src/terminal-compat.js";

test("compat StripTerminalSequences 剥离 CSI/OSC/APC 序列并保留可见文本", () => {
  const csi = "\x1b[31mred\x1b[0m";
  assert.equal(stripTerminalSequences(csi), "red");

  const osc8 = "\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\";
  assert.equal(stripTerminalSequences(osc8), "link");

  const osc7 = "\x1b]7;test\x07bell";
  assert.equal(stripTerminalSequences(osc7), "bell");

  const apc = "\x1b_progress:42\x07done";
  assert.equal(stripTerminalSequences(apc), "done");

  // 无转义序列时原样返回
  assert.equal(stripTerminalSequences("plain text"), "plain text");
});

test("fallbackStripTerminalSequences 与兼容导出行为一致", () => {
  const samples = [
    "\x1b[1;32mbold green\x1b[0m",
    "\x1b]8;;https://example.com\x1b\\osc8 link\x1b]8;;\x1b\\",
    "\x1b]0;title\x07\u0007oscterm",
    "\x1b_APC data\x1b\\",
    "", // 空串
    "混合\x1b[31m颜色\x1b[39m文本",
  ];
  for (const sample of samples) {
    assert.equal(stripTerminalSequences(sample), fallbackStripTerminalSequences(sample));
  }
});

test("unfinished escape sequences 原样保留（与上游一致）", () => {
  // 未终止的 CSI/OSC 不匹配 extractAnsiCode，保持原文
  assert.equal(stripTerminalSequences("unfinished \x1b[31"), "unfinished \x1b[31");
  assert.equal(stripTerminalSequences("unfinished \x1b]8;;"), "unfinished \x1b]8;;");
});

test("extractAnsiCode 定位三类序列", () => {
  const csi = extractAnsiCode("\x1b[34mblue", 0);
  assert.deepEqual(csi, { code: "\x1b[34m", length: 5 });
  assert.equal(extractAnsiCode("\x1b[34mblue", 5), null);
  assert.equal(extractAnsiCode("no escape", 0), null);
  assert.equal(extractAnsiCode("", 0), null);
  assert.equal(extractAnsiCode("x", 5), null);
});

test("safeTerminalText/safeGoalMenuText 在降级环境下正常工作", async () => {
  // 直接经错误处理路径验证 goal_complete 通知文本的清洗链路
  const { safeGoalMenuText, safeTerminalText } = await import("../src/errors.js");
  const input = "\x1b[1m完成\x1b[0m（\x1b]8;;https://example.com\x1b\\已实现\x1b]8;;\x1b\\）";
  assert.equal(safeTerminalText(input), "完成（已实现）");
  const trimmed = safeGoalMenuText(`   ${input}   剩余文本 `.repeat(60));
  assert.ok(trimmed.length <= 120 + 1);
  assert.ok(trimmed.endsWith("…"));
});
