# 移植 @juicesharp/rpiv-*2.4.0 → @schovest/pi-*：btw / todo / ask-user-question

日期：2026-08-04
状态：已批准（2026-08-04，决策矩阵见文末）

## 背景

用户希望基于 `@juicesharp/rpiv-*` 最新版本（2.4.0，npm == GitHub main，2026-08-03）开发自己的
`btw`、`todo`、`ask-user-question` 三个 Pi 扩展。经澄清，采用**全量移植**方案：代码原样搬入
`pi-package-mono` 仓库，包名换为 `@schovest/pi-*` 作用域，共享依赖（config/i18n）一并移植为独立包，
上游测试整体搬运。

## 范围

### 新包（6 个）

| 包 | 来源 | 内容 | 发布 |
| --- | --- | --- | --- |
| `@schovest/pi-btw` | `rpiv-btw` | 6 ts + prompts/ + docs/ | 是 |
| `@schovest/pi-todo` | `rpiv-todo` | 15 ts（state/ + tool/ + view/）+ locales/ | 是 |
| `@schovest/pi-ask-user-question` | `rpiv-ask-user-question` | 38 ts（state/ + tool/ + view/，含 `./events` 子路径导出）+ locales/ | 是 |
| `@schovest/pi-config` | `rpiv-config` | 2 ts | 是 |
| `@schovest/pi-i18n` | `rpiv-i18n` | 4 ts + `/loader` 子路径（软可选 peer） | 是 |
| `@schovest/pi-test-utils` | `test-utils` | 11 ts | 否（`private: true`） |

依赖关系（与上游一致）：

- `pi-todo` → deps: `@schovest/pi-config`；软可选 peer: `@schovest/pi-i18n`（动态 import，缺失时回退英文文案）
- `pi-ask-user-question` → deps: `@schovest/pi-config`；软可选 peer: `@schovest/pi-i18n`
- `pi-i18n` → deps: `@schovest/pi-config`
- 三者 peerDeps: `@earendil-works/pi-ai` / `pi-coding-agent` / `pi-tui`（`*`）
- `pi-config` → deps: `typebox`
- 测试方引用 `@schovest/pi-test-utils`（不发布）

### 功能保留（100%）

- **pi-btw**：`/btw <question>` 命令；底部面板；会话内历史追问；预算控制（btw-budget）；
  只读会话克隆上下文；答案不落盘。
- **pi-todo**：`todo` 工具、`/todos` 命令、编辑器上方实时覆盖层；状态机 + task-graph；
  从会话重建（replay），存活 `/reload` 与 compaction；overlay 快捷键。
- **pi-ask-user-question**：`ask_user_question` 工具；分页签对话框（≤4 问）；选项 + 描述 +
  preview markdown 面板；`Type something.` 自由输入行；notes；`Ctrl+]` 折叠；
  RPC/ACP fallback（rpc-fallback.ts）；非交互环境移除工具；i18n（9 语言 locales）。

## 改造点（相对上游的偏差）

### 1. 命名与导入替换

- 包名 `@juicesharp/rpiv-*` → `@schovest/pi-*`
- 全部源码 + 测试中的 `@juicesharp/rpiv-config` → `@schovest/pi-config`、
  `@juicesharp/rpiv-i18n` → `@schovest/pi-i18n`（含动态 `import("@juicesharp/rpiv-i18n/loader")`）
- `@juicesharp/rpiv-test-utils` → `@schovest/pi-test-utils`
- 替换范围覆盖：运行时文件、测试文件、i18n-bridge 的动态 import、注释中的包名引用

### 2. rpiv-workflow 类型 stub

`pi-test-utils` 的 `pi.ts` 与 `concurrent-host.ts` 有 3 个**类型级** import 来自
`@juicesharp/rpiv-workflow`（`ModelSelection`、`WorkflowHostContext`、`WorkflowSessionContext`）。
rpiv-workflow 不在移植范围。处理：在 `pi-test-utils` 内定义最小接口 stub（仅 `import type` 使用），
不引入 rpiv-workflow 包。

### 3. test/setup.ts 裁剪重写

上游 `test/setup.ts` 动态 import 9 个 rpiv-mono 其他包（advisor/args/workflow/pi/warp/telemetry/
voice/web-tools 等）做状态清理，与本仓库范围不符。重写为仅覆盖本 5 包：

- `todo.__resetState()`（todo.ts 导出）
- `i18n.__resetState()`（i18n.ts 导出）
- 清理 `~/.config/rpiv-todo/config.json`、`~/.config/rpiv-ask-user-question/config.json`、
  `~/.config/rpiv-i18n/locale.json`、`~/.pi/agent/` 等测试路径
- 保留 pi-ai 与 `@earendil-works/pi-ai/compat` 的 mock（`getSupportedThinkingLevels`、
  `completeSimple` stub，pi 0.80+ 需要），沿用 setup.ts 顶部注释的"动态 import 防真实 homedir 泄漏"设计

### 4. 工具链对齐上游（D2=A）

| 工具 | 当前仓库 | 目标 |
| --- | --- | --- |
| vitest | 3.2.7 | ^4.1.10 |
| typescript | 5.9.3 | ^6.0.3 |
| @types/node | ^22.0.0 | 22.20.1 |
| typebox | ^1.3.0（装 1.3.3） | 对齐（1.3.6 满足现有范围即可） |
| biome | 1.9.4 | **保持 1.9.4**（配置格式 2.x 有破坏性变更，bump 无收益；本仓库 biome 规则比上游更宽松） |

现有 4 个包（goal/tps/sudo-helper/pi-mcp-adapter）无存量测试；若 TS 6 报错则最小修复。
biome 1.9.4 对本仓库与上游源码均按现有 2 空格配置格式化。

### 5. pi-* SDK devDeps 版本（D1=A）

新包 devDeps 锁定 `@earendil-works/pi-ai` / `pi-coding-agent` / `pi-tui` 为 **0.80.5**（上游测试验证版本）。
现有包（goal/tps/sudo-helper/pi-mcp-adapter）保留其现有 pin（0.74.2/0.79.10），
npm workspaces 会为冲突版本做嵌套安装，tsc/vitest 按文件路径向上解析各自版本。

### 6. 相对导入后缀（D3=A）

保留上游 `.js` 后缀（`./config.js` 等）。Node16 模块解析下 `.js` → `.ts` 映射正常；
与上游 diff 最小，便于后续跟踪更新。仓库 AGENTS.md 的 `.ts` 约定不适用于移植代码。

### 7. package.json 适配

- 并入仓库 lockstep 版本（0.1.2），`sync-versions.js` 自动同步 `pi-config`/`pi-i18n` 依赖
- 按仓库约定补 `types` / `exports`（`.ts` 直出）；上游有 `exports` 的（ask-user-question 的
  `./events`、i18n 的 `./loader`）保留并适配
- `files` 列表包含全部运行文件与 locales；测试文件不发布
- `pi-test-utils` 标 `private: true`（npm publish 自动跳过）
- LICENSE：MIT，保留上游版权署名（juicesharp）

## 运行时兼容性（已验证）

用户 pi 为自研 fork `@schovest/pi-coding-agent@0.13.2`，其扩展加载器
（`packages/coding-agent/src/core/extensions/loader.ts`，jiti + Bun VIRTUAL_MODULES）将
`@earendil-works/pi-tui`/`pi-ai`/`pi-coding-agent`（及 /compat、/oauth 子路径）全部别名到内置模块，
并覆盖 `@schovest` / `@mariozechner` 旧作用域。因此移植代码中的 45 处 pi-* 值导入（Text、
Container、truncateToWidth、Key、matchesKey、DynamicBorder、StringEnum 等）在运行时可用。

## 错误处理与降级

- 上游设计即健壮：i18n 缺失回退英文、config 损坏回退默认值、RPC fallback 降级、非交互环境移除工具
- 移植不改变这些行为

## 测试策略

- 搬运上游 65 个测试文件（btw 6 / todo 19 / ask-user-question 32 / config 2 / i18n 5 / test-utils 1）
- 不新写测试；上游测试即行为基线
- 成功标准：
  1. `npm run check`（biome + tsc）零错误
  2. `npm test` 全绿
  3. `npm run publish:dry` 通过（5 个非 private 包可发布）
  4. 手动抽查：测试覆盖的注册/命令/工具定义与 README 描述一致

## 决策记录

| 决策点 | 选择 |
| --- | --- |
| 移植策略 | 全量移植（代码原样、改名） |
| 包命名 | `@schovest/pi-*` |
| 测试 | 搬运上游测试 |
| 共享依赖 | 移植为独立包（pi-config / pi-i18n） |
| D1 pi-* SDK 版本 | 0.80.5（上游测试版本） |
| D2 测试工具链 | 对齐上游（vitest 4.x / TS 6.x），biome 保持 1.9.4 |
| D3 导入后缀 | 保留上游 `.js` |
