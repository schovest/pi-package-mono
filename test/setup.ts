import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, vi } from "vitest";

const TEST_HOME = mkdtempSync(join(tmpdir(), "pi-pkg-test-home-"));
process.env.HOME = TEST_HOME;
process.env.USERPROFILE = TEST_HOME;
delete process.env.PI_CODING_AGENT_DIR;
delete process.env.XDG_CONFIG_HOME;
delete process.env.WEB_SEARCH_PROVIDER;

vi.mock("@earendil-works/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-ai")>();
  return {
    ...actual,
    getSupportedThinkingLevels: vi.fn(() => ["off", "minimal", "low", "medium", "high"]),
  };
});

// pi 0.80+：`completeSimple` 位于 /compat 入口；btw 的 pi-compat.ts 经
// loadCompleteSimple() 优先走 /compat，stub 需注册在这里才能被拾取。
vi.mock("@earendil-works/pi-ai/compat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-ai/compat")>();
  return {
    ...actual,
    completeSimple: vi.fn(),
    getSupportedThinkingLevels: vi.fn(() => ["off", "minimal", "low", "medium", "high"]),
  };
});

// 包模块在 beforeEach 内动态 import（不要提升为静态 import）：
// 1. 静态 import 会先于 process.env.HOME 赋值执行，生产模块 homedir() 捕获到真实 HOME；
// 2. 测试文件的 vi.mock(node:fs) 等依赖自己是包的首次加载者，setup 静态 import 会封死 mock。
beforeEach(async () => {
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.WEB_SEARCH_PROVIDER;

  // 注意：pi-todo 的 __resetState 在 Task 7 才加入此 beforeEach——pi-todo 尚未
  // 移植时动态 import 不存在的模块会让全仓 beforeEach 抛错，顺序不可提前。
  const i18n = await import("../packages/pi-i18n/i18n.js");
  i18n.__resetState();

  delete (globalThis as Record<symbol, unknown>)[Symbol.for("rpiv-btw")];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("rpiv-i18n")];

  const { configPath } = await import("@schovest/pi-config");
  const todoConfig = configPath("rpiv-todo");
  const askUserQuestionConfig = configPath("rpiv-ask-user-question");
  const i18nConfig = configPath("rpiv-i18n", "locale.json");
  rmSync(todoConfig, { force: true });
  rmSync(askUserQuestionConfig, { force: true });
  rmSync(i18nConfig, { force: true });
  rmSync(join(process.env.HOME!, ".pi", "agent"), { recursive: true, force: true });
});
