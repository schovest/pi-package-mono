import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMockCtx, createMockPi } from "@schovest/pi-test-utils";
import { describe, expect, it } from "vitest";
import sudoHelper from "./index.ts";

/** 注册扩展并取回 before_agent_start handler */
function registerHandler() {
  const { pi, captured } = createMockPi();
  sudoHelper(pi);
  const handlers = captured.events.get("before_agent_start");
  expect(handlers).toBeDefined();
  return handlers![0] as (
    event: { systemPrompt: string },
    ctx: ExtensionContext,
  ) => { systemPrompt: string } | undefined;
}

describe("sudo-helper 系统提示词注入", () => {
  it("hasUI=true 时在 systemPrompt 末尾追加 sudo 说明", () => {
    const handler = registerHandler();
    const result = handler({ systemPrompt: "BASE_PROMPT" }, createMockCtx({ hasUI: true }));

    expect(result).toBeDefined();
    expect(result!.systemPrompt.startsWith("BASE_PROMPT")).toBe(true);
    expect(result!.systemPrompt).toContain("已配置 sudo-helper");
    expect(result!.systemPrompt).toContain("单条 bash 命令中最多使用一个 sudo");
    expect(result!.systemPrompt).toContain("sudo bash -c 'systemctl restart a && systemctl restart b'");
    expect(result!.systemPrompt).toContain("错误示例");
    expect(result!.systemPrompt).toContain("sudo -S");
  });

  it("hasUI=false 时不注入（无 UI 时 sudo-helper 不工作，注入会误导 agent）", () => {
    const handler = registerHandler();
    const result = handler({ systemPrompt: "BASE_PROMPT" }, createMockCtx({ hasUI: false }));

    expect(result).toBeUndefined();
  });
});
