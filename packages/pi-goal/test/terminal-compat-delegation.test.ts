/**
 * 高版本环境探测：pi-tui ≥0.84 导出 stripTerminalSequences 时，兼容层必须
 * 委托官方实现；缺失（0.80.5 / schovest fork）才回退本地实现。
 */

import assert from "node:assert/strict";
import { test, vi } from "vitest";

vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-tui")>();
  return {
    ...actual,
    stripTerminalSequences: (value: string) => `official(${value})`,
  };
});

test("pi-tui 提供 stripTerminalSequences 时优先用官方实现", async () => {
  const { stripTerminalSequences } = await import("../src/terminal-compat.js");
  assert.equal(stripTerminalSequences("\x1b[31mred\x1b[0m"), "official(\x1b[31mred\x1b[0m)");
});
