import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { createMockCtx, createMockPi } from "@schovest/pi-test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sudoHelper from "./index.ts";

// spawn / fs 打桩：单测环境里 FIFO 不存在，真实进程会 EPIPE、chmod 会 ENOENT
// —— 把子进程与文件系统全部虚拟化，tool_call 全流程纯内存跑通
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
spawnMock.mockImplementation(() => ({
  stdin: { write: () => true, end: () => {} },
  kill: () => {},
}));
vi.mock("node:fs/promises", () => ({
  chmod: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

/** tool_call / tool_result 处理器的事件形态（与 runner 事件结构一致） */
interface ToolCallLike {
  type: "tool_call";
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}
interface ToolResultLike {
  type: "tool_result";
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
  details?: unknown;
}

/** ToolResultEventResult 的测试用子集 */
interface ToolResultHandlerResult {
  content?: Array<{ type: string; text?: string }>;
}

type ToolCallHandler = (event: ToolCallLike, ctx: ExtensionContext) => Promise<unknown>;
type ToolResultHandler = (event: ToolResultLike, ctx: ExtensionContext) => Promise<ToolResultHandlerResult | undefined>;

/** 注册扩展，取回 tool_call / tool_result 处理器 */
function registerHandlers() {
  const { pi, captured } = createMockPi();
  sudoHelper(pi);
  const callHandler = captured.events.get("tool_call")?.[0] as ToolCallHandler | undefined;
  const resultHandler = captured.events.get("tool_result")?.[0] as ToolResultHandler | undefined;
  expect(callHandler).toBeDefined();
  expect(resultHandler).toBeDefined();
  return { pi, callHandler: callHandler!, resultHandler: resultHandler!, captured };
}

/** 预检默认走「免密」（mock exec code 0），tool_call 只记录 callCtx，不触弹窗/FIFO */
async function callBash(callHandler: ToolCallHandler, command: string, toolCallId = "c1", hasUI = true) {
  return callHandler({ type: "tool_call", toolName: "bash", toolCallId, input: { command } }, createMockCtx({ hasUI }));
}

/** 触发 bash tool_result（isError 时按 bash 工具行为附加 "Command exited" 尾部） */
function resultBash(
  resultHandler: ToolResultHandler,
  opts: { toolCallId?: string; output?: string; isError?: boolean } = {},
) {
  const { toolCallId = "c1", output = "", isError = true } = opts;
  const text =
    isError && output && !output.includes("Command exited with code")
      ? `${output}\n\nCommand exited with code 1`
      : output;
  return resultHandler(
    {
      type: "tool_result",
      toolName: "bash",
      toolCallId,
      input: { command: "<irrelevant: 改写后的命令>" },
      content: [{ type: "text", text }],
      isError,
      details: undefined,
    },
    createMockCtx({ hasUI: true }),
  );
}

/** 提取追加的提示文本（断言已存在且为第二个 content 块） */
function getHint(result: ToolResultHandlerResult | undefined): string {
  expect(result?.content).toBeDefined();
  expect(result!.content!.length).toBe(2);
  const hint = result!.content![1];
  expect(hint.type).toBe("text");
  return (hint as { type: string; text: string }).text;
}

describe("sudo-helper 反应式失败提示", () => {
  it("不再注入 before_agent_start 系统提示词", () => {
    const { captured } = registerHandlers();
    expect(captured.events.has("before_agent_start")).toBe(false);
  });

  it("失败 + 多个裸 sudo → 追加提示且含 sudo bash -c 格式", async () => {
    const { callHandler, resultHandler } = registerHandlers();
    await callBash(callHandler, "sudo systemctl restart a && sudo systemctl restart b");
    const result = await resultBash(resultHandler, { output: "sudo: a password is required" });

    const hint = getHint(result);
    expect(hint).toContain("失败片段");
    expect(hint).toContain("a password is required");
    expect(hint).toContain("多个 sudo");
    expect(hint).toContain("sudo bash -c");
    expect(hint).toContain("外层单引号");
  });

  it("失败 + sudo -n 探测 → 提示不要探测", async () => {
    const { callHandler, resultHandler } = registerHandlers();
    await callBash(callHandler, "sudo -n true");
    const result = await resultBash(resultHandler, { output: "sudo: a password is required" });

    const hint = getHint(result);
    expect(hint).toContain("sudo -n");
    expect(hint).toContain("不需探测");
  });

  it("失败 + sudo bash -c 双引号包裹 → 提示改外层单引号", async () => {
    const { callHandler, resultHandler } = registerHandlers();
    await callBash(callHandler, 'sudo bash -c "systemctl restart a && systemctl restart b"');
    const result = await resultBash(resultHandler, { output: "systemctl: command failed" });

    const hint = getHint(result);
    expect(hint).toContain("外层单引号");
    expect(hint).toContain("sudo bash -c");
  });

  it("成功（isError=false）→ 不追加提示", async () => {
    const { callHandler, resultHandler } = registerHandlers();
    await callBash(callHandler, "sudo apt update");
    const result = await resultBash(resultHandler, { output: "All packages are up to date.", isError: false });

    expect(result).toBeUndefined();
  });

  it("失败但无 sudo 上下文（未记录 callCtx）→ 不追加提示", async () => {
    const { resultHandler } = registerHandlers();
    // 不调用 tool_call（模拟非 sudo 调用 / 已取消的调用）
    const result = await resultBash(resultHandler, { output: "ERROR: something bad" });

    expect(result).toBeUndefined();
  });

  it("hasUI=false 时不记录上下文：失败也不提示", async () => {
    const { callHandler, resultHandler } = registerHandlers();
    await callBash(callHandler, "sudo apt update", "c1", false);
    const result = await resultBash(resultHandler, { toolCallId: "c1", output: "sudo: a password is required" });

    expect(result).toBeUndefined();
  });

  it("失败 + 结构合规但命令本身出错 → 静默不提示", async () => {
    const { callHandler, resultHandler } = registerHandlers();
    await callBash(callHandler, "sudo apt install no-such-package");
    const result = await resultBash(resultHandler, { output: "Unable to locate package no-such-package" });

    expect(result).toBeUndefined();
  });

  it("失败 + 无结构问题（sudo 认证报错）→ 静默不提示", async () => {
    const { callHandler, resultHandler } = registerHandlers();
    await callBash(callHandler, "sudo systemctl restart a");
    const result = await resultBash(resultHandler, { output: "sudo: a password is required" });

    expect(result).toBeUndefined();
  });

  it("失败 + 多裸 sudo + 中文报错 → 门控照常且失败片段定位到中文报错行", async () => {
    const { callHandler, resultHandler } = registerHandlers();
    await callBash(callHandler, "sudo systemctl restart a && sudo systemctl restart b");
    const result = await resultBash(resultHandler, {
      output:
        "sudo：用户 luokxy 不在 sudoers 文件中。\n此事将被报告。\nsystemctl: 操作拒绝\n\nCommand exited with code 1",
    });

    const hint = getHint(result);
    // 门控不依赖输出语言：结构问题照样提示
    expect(hint).toContain("多个 sudo");
    expect(hint).toContain("sudo bash -c");
    // 失败片段命中中文签名（不在 sudoers）
    expect(hint).toContain("不在 sudoers 文件");
  });

  it("失败 + 无签名但输出含 sudo 行（语言无关兜底）→ 片段取 sudo 行", async () => {
    const { callHandler, resultHandler } = registerHandlers();
    // 用 sudo -n 探测触发结构问题门控；输出无认证签名但有 sudo 前缀行
    await callBash(callHandler, "sudo -n true");
    const result = await resultBash(resultHandler, {
      output: "Job for systemd-resolved.service failed\nsudo: 无法解析主机名\nSee system logs for details.",
    });

    const hint = getHint(result);
    expect(hint).toContain("sudo: 无法解析主机名");
  });
});

// ============================================================================
// 密码输入超时：120s 无输入自动取消，不长期阻塞 tool_call
// ============================================================================

/** 密码输入组件的测试用子集（组件未导出，结构断言） */
interface PasswordInputLike {
  handleInput(data: string): boolean | undefined;
  render(width: number): string[];
  timedOut: boolean;
}

type DoneFn = (value: boolean) => void;
type CustomFactory = (tui: unknown, theme: unknown, keybindings: unknown, done: DoneFn) => unknown;

/**
 * 弹窗测试夹具：mock ui.custom 捕获组件工厂、mock exec 让预检返回「需要密码」。
 * 供「密码输入超时」与「命令详情显示」两个 describe 共用。
 */
function makeDialogHarness() {
  let factoryRef: CustomFactory | undefined;
  const customMock = vi.fn((factory: CustomFactory) => {
    factoryRef = factory;
    // 模拟 pi UI：done 调用时关闭弹窗并回传结果
    return new Promise<boolean>((resolve) => {
      (customMock as unknown as { resolveRef?: (v: boolean) => void }).resolveRef = resolve;
    });
  });
  // sudo -n true 返回 1（需要密码），mkfifo 返回 0（成功）
  const execMock = vi.fn(async (cmd: string) => ({
    stdout: "",
    stderr: "",
    code: cmd === "sudo" ? 1 : 0,
    killed: false,
  }));

  return {
    customMock,
    /** 重置夹具状态并启用 fake timers（afterEach 里 useRealTimers 由 describe 负责） */
    reset() {
      vi.useFakeTimers();
      factoryRef = undefined;
      execMock.mockClear();
      customMock.mockClear();
    },
    /** 触发 sudo tool_call，驱动到密码弹窗弹出，返回 handler Promise 与组件实例 */
    async callSudoWithDialog(command: string) {
      const { pi, callHandler } = registerHandlers();
      (pi as unknown as { exec: unknown }).exec = execMock;
      const input: Record<string, unknown> = { command };
      const ctx = createMockCtx({
        hasUI: true,
        ui: { custom: customMock as unknown as ExtensionUIContext["custom"] },
      });
      const pending = callHandler({ type: "tool_call", toolName: "bash", toolCallId: "c1", input }, ctx);
      // 等 handler 走完预检/FIFO 准备、弹出密码框（fake timers 下用微任务推进）
      for (let i = 0; i < 50 && !factoryRef; i++) await vi.advanceTimersByTimeAsync(1);
      expect(factoryRef).toBeDefined();
      const resolveRef = (customMock as unknown as { resolveRef?: DoneFn }).resolveRef!;
      const comp = factoryRef!(undefined, undefined, undefined, resolveRef) as PasswordInputLike;
      return { pending, comp, input };
    },
  };
}

describe("sudo-helper 密码输入超时", () => {
  const h = makeDialogHarness();
  beforeEach(() => h.reset());
  afterEach(() => {
    vi.useRealTimers();
  });

  it("120s 无输入 → 超时自动取消：block + 超时 reason，命令不改写", async () => {
    const { pending, comp, input } = await h.callSudoWithDialog("sudo systemctl restart nginx");
    expect(comp.timedOut).toBe(false);

    await vi.advanceTimersByTimeAsync(120_000);
    const result = (await pending) as { block: boolean; reason: string } | undefined;

    expect(comp.timedOut).toBe(true);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("超时");
    expect(input["command"]).toBe("sudo systemctl restart nginx"); // 未被改写
  });

  it("超时前提交 → 命令改写为 SUDO_ASKPASS sudo -A，后续时间推进无副作用", async () => {
    const { pending, comp, input } = await h.callSudoWithDialog("sudo systemctl restart nginx");
    comp.handleInput("p");
    comp.handleInput("w");
    comp.handleInput("\r"); // Enter 提交
    const result = await pending;

    expect(result).toBeUndefined(); // 放行执行
    expect(comp.timedOut).toBe(false);
    expect(input["command"]).toContain("SUDO_ASKPASS=");
    expect(input["command"]).toContain("sudo -A");

    // 超时定时器已清：推进 10 分钟不应二次触发/报错
    await vi.advanceTimersByTimeAsync(600_000);
    expect(comp.timedOut).toBe(false);
  });

  it("Esc 主动取消 → reason 是用户取消而非超时", async () => {
    const { pending, comp } = await h.callSudoWithDialog("sudo apt update");
    comp.handleInput("\x1b"); // Escape
    const result = (await pending) as { block: boolean; reason: string } | undefined;

    expect(comp.timedOut).toBe(false);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("取消");
    expect(result?.reason).not.toContain("超时");
  });

  it("提示行标注超时行为", async () => {
    const { comp } = await h.callSudoWithDialog("sudo apt update");
    const rendered = comp.render(40).join("\n");
    expect(rendered).toContain("120s");
    expect(rendered).toContain("超时");
  });
});

// ============================================================================
// 命令详情显示：输入行上方展示 sudo 命令（收起态 3 行 / Tab 展开 / 键盘滚动）
// ============================================================================

describe("sudo-helper 命令详情显示", () => {
  const h = makeDialogHarness();
  beforeEach(() => h.reset());
  afterEach(() => {
    vi.useRealTimers();
  });

  const LINE_UP = "\x1b[A";
  const LINE_DOWN = "\x1b[B";
  const PAGE_UP = "\x1b[5~";
  const PAGE_DOWN = "\x1b[6~";
  const WHEEL_UP = "\x1b[<64;10;5M";
  const WHEEL_DOWN = "\x1b[<65;10;5M";

  /** 判断 pending 是否仍 unresolved（弹窗未关闭 = 滚动键被组件消化，未影响宿主路径） */
  async function expectStillOpen(pending: Promise<unknown>) {
    let settled = false;
    pending.then(() => (settled = true)).catch(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
  }

  function manyLines(n: number): string {
    return Array.from({ length: n }, (_, i) => `sudo c${i + 1}`).join("\n");
  }

  it("短命令：原样显示在输入行上方，无展开提示", async () => {
    const { comp } = await h.callSudoWithDialog("sudo apt update");
    const lines = comp.render(40);
    const joined = lines.join("\n");
    expect(joined).toContain("$ sudo apt update");
    expect(joined).not.toContain("…");
    expect(joined).not.toContain("Tab");
    const cmdIdx = lines.findIndex((l) => l.includes("$ sudo apt update"));
    const inputIdx = lines.findIndex((l) => l.includes(">"));
    expect(cmdIdx).toBeGreaterThan(-1);
    expect(cmdIdx).toBeLessThan(inputIdx);
  });

  it("多逻辑行：收起态只显示前 3 行 + 还有 N 行提示", async () => {
    const { comp } = await h.callSudoWithDialog("sudo a1\nsudo a2\nsudo a3\nsudo a4\nsudo a5");
    const joined = comp.render(40).join("\n");
    expect(joined).toContain("$ sudo a1");
    expect(joined).toContain("$ sudo a2");
    expect(joined).toContain("$ sudo a3");
    expect(joined).not.toContain("$ sudo a4");
    expect(joined).toContain("还有 2 行");
    expect(joined).toContain("Tab 展开全部");
  });

  it("单行超长：行内截断加省略号，可展开", async () => {
    const { comp } = await h.callSudoWithDialog(`sudo ${"x".repeat(60)}`);
    const joined = comp.render(40).join("\n");
    expect(joined).toContain("…");
    expect(joined).toContain("Tab 展开全部");
  });

  it("Tab 展开：显示完整命令；再 Tab 收起", async () => {
    const { comp } = await h.callSudoWithDialog("sudo a1\nsudo a2\nsudo a3\nsudo a4\nsudo a5");
    comp.handleInput("\t"); // 展开
    const expanded = comp.render(40).join("\n");
    expect(expanded).toContain("$ sudo a4");
    expect(expanded).toContain("$ sudo a5");
    expect(expanded).toContain("Tab 收起");
    expect(expanded).not.toContain("还有");

    comp.handleInput("\t"); // 收起
    const collapsed = comp.render(40).join("\n");
    expect(collapsed).not.toContain("$ sudo a4");
    expect(collapsed).toContain("还有 2 行");
  });

  it("展开态超视口：1-10/15 位置指示，↑↓ 滚动，PgUp/PgDn 翻页，边界钳制", async () => {
    const { comp } = await h.callSudoWithDialog(manyLines(15));
    comp.handleInput("\t");
    let joined = comp.render(40).join("\n");
    expect(joined).toContain("1-10/15");
    expect(joined).toContain("$ sudo c1");
    expect(joined).not.toContain("$ sudo c15");

    comp.handleInput(LINE_DOWN); // ↓ 滚 1 行
    joined = comp.render(40).join("\n");
    expect(joined).toContain("2-11/15");
    expect(joined).toContain("$ sudo c11");

    comp.handleInput(PAGE_DOWN); // PgDn：offset 1+10 → 钳到底部 5
    joined = comp.render(40).join("\n");
    expect(joined).toContain("6-15/15");
    expect(joined).toContain("$ sudo c15");

    comp.handleInput(LINE_DOWN); // 底部再 ↓ 不动
    expect(comp.render(40).join("\n")).toContain("6-15/15");

    comp.handleInput(PAGE_UP); // PgUp 翻回顶部
    expect(comp.render(40).join("\n")).toContain("1-10/15");

    comp.handleInput(LINE_UP); // 顶部再 ↑ 不动
    expect(comp.render(40).join("\n")).toContain("1-10/15");
  });

  it("展开态内容不超视口：无滚动指示", async () => {
    const { comp } = await h.callSudoWithDialog("sudo a1\nsudo a2\nsudo a3");
    comp.handleInput("\t");
    const joined = comp.render(40).join("\n");
    expect(joined).toContain("$ sudo a3");
    expect(joined).not.toContain("↑↓");
  });

  it("滚轮序列防御解析：展开态滚动，收起态忽略", async () => {
    const { comp } = await h.callSudoWithDialog(manyLines(15));
    comp.handleInput(WHEEL_DOWN); // 收起态：忽略，仍收起
    expect(comp.render(40).join("\n")).toContain("还有 12 行");

    comp.handleInput("\t");
    comp.handleInput(WHEEL_DOWN);
    expect(comp.render(40).join("\n")).toContain("2-11/15");
    comp.handleInput(WHEEL_UP);
    expect(comp.render(40).join("\n")).toContain("1-10/15");
  });

  it("收起→展开→收起：滚动偏移复位", async () => {
    const { comp } = await h.callSudoWithDialog(manyLines(15));
    comp.handleInput("\t");
    comp.handleInput(LINE_DOWN);
    comp.handleInput(LINE_DOWN);
    expect(comp.render(40).join("\n")).toContain("3-12/15");
    comp.handleInput("\t"); // 收起
    comp.handleInput("\t"); // 再展开 → 从头开始
    expect(comp.render(40).join("\n")).toContain("1-10/15");
  });

  it("滚动键被组件完整消化：不提交、不取消、弹窗保持打开", async () => {
    const { pending, comp } = await h.callSudoWithDialog(manyLines(15));
    comp.handleInput("\t");
    for (const key of [LINE_UP, LINE_DOWN, PAGE_UP, PAGE_DOWN, WHEEL_UP, WHEEL_DOWN]) {
      comp.handleInput(key);
    }
    await expectStillOpen(pending);
    expect(comp.timedOut).toBe(false);
    // 弹窗仍可正常交互：Esc 取消生效
    comp.handleInput("\x1b");
    const result = (await pending) as { block: boolean } | undefined;
    expect(result?.block).toBe(true);
  });
});
