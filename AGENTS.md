# AGENTS.md

Pi 扩展单仓的行为准则。与通用指南叠加使用。

## 项目约定

### 包结构

- 每个 `packages/<name>/` 是一个独立的 Pi 扩展
- 扩展入口由 `package.json` 的 `pi.extensions` 声明
- 发布原始 `.ts` 源码，不做构建
- 每个包独立维护版本号（见「版本管理」）

当前包（11 个）：

| 包 | 说明 | 发布 |
| --- | --- | --- |
| `pi-btw` | `/btw` 侧问命令（底部面板，答案不落盘） | ✅ |
| `pi-todo` | `todo` 工具 + `/todos` 命令 + 实时覆盖层（存活 compaction） | ✅ |
| `pi-ask-user-question` | `ask_user_question` 分页签对话框工具 | ✅ |
| `pi-config` | 共享配置 I/O（configPath/loadJsonConfig 等） | ✅ |
| `pi-i18n` | 本地化基础（locale 检测、/loader 子路径、软可选） | ✅ |
| `pi-test-utils` | 测试夹具（verifyShipManifest、mock Pi 等） | ❌ private |
| `pi-goal` | goal 自主编排扩展（迁移自 narumitw/pi-goal，含 pi-tui 降级兼容） | ✅ |
| `pi-mcp-adapter` | MCP 适配器 | ✅ |
| `pi-sudo-helper` | sudo 密码注入 | ✅ |
| `pi-tps` | tokens-per-second 监控 | ✅ |
| `pi-hermes-memory` | 🧠 持久记忆 + 会话搜索 + 学习循环（SQLite FTS5） | ✅（未首发） |

`pi-btw`/`pi-todo`/`pi-ask-user-question`/`pi-config`/`pi-i18n` 基于
[@juicesharp/rpiv-* 2.4.0](https://github.com/juicesharp/rpiv-mono) 全量移植。
**移植约定（不可破坏）**：相对导入保留上游 `.js` 后缀（`./config.js`）；
`rpiv-*` 字符串字面量（配置路径 `~/.config/rpiv-*`、`Symbol.for("rpiv-*")`、组件 key）原样保留，
改了就破坏行为/迁移；LICENSE 保留上游 juicesharp 版权署名。

`pi-hermes-memory` 迁移自 [chandra447/pi-hermes-memory](https://github.com/chandra447/pi-hermes-memory) v0.9.6（npm 安装版基线，非 GitHub HEAD）。
**移植约定**：相对导入保留 `.js` 后缀；src 与上游一致，`tests/` 从 GitHub 全文检出并适配 vitest（上游用 node:test + tsx 逐文件跑，且上游 tsc 不检查测试——本仓检查，已补齐类型）；
`scripts/`（ensure-dev/check-min-sdk）与 `tests/run-all.sh` 已裁掉（单仓根 check/test 取代）；测试文件用 `beforeAll/afterAll/onTestFinished`、`describe` 不带 `{ concurrency }` 选项；
LICENSE 保留上游 Chandra Teja 版权署名；上游未发布修复 #189（childExtensionSources 语义）为跟进项，勿混入。

`pi-goal`（目录 `packages/goal`）迁移自 [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions) `packages/pi-goal` v0.52.2（npm tarball 与 tag 源一致）。
**移植约定**：相对导入保留 `.js` 后缀；src 全量搬运，旧弱实现（单文件 index.ts）已删除；`scripts/build-runtime.mjs`、`dist/` 产物与 3 个 dist 构建测试（build-runtime/generated-entry/goal-runtime-smoke）不适用已裁掉；`test/support.ts`（createMockPi/createMockContext）放在仓根 `test/`，上游 `../../../test/support.js` 相对导入保持不变；persistence 子进程测试已改为 `--import tsx` + 源码路径（上游用 node_modules/.cache 构建产物）。
**降级兼容（关键）**：上游依赖 pi-tui 0.84+ 的 `stripTerminalSequences`（0.80.5 缺失 → goal_complete 报 `is not a function`）；`src/terminal-compat.ts` 用命名空间导入 + 探测（`??` 回退本地等价实现，逻辑与上游 extractAnsiCode/stripTerminalSequences 一致），errors.ts 改从该模块导入。升级上游后若 pi-tui 已导出该函数，命中断言：本包 devDeps 固定在 0.80.5，勿随上游升到 0.84（除非同时加兼容层）。

### 代码风格

- TypeScript strict 模式
- 2 空格缩进，120 字符行宽
- Biome 负责格式化和 lint（配置在根 `biome.json`，当前 1.9.4，勿随意升级）
- 导入使用 `.ts` 扩展名（`from "./foo.ts"`）——移植包除外（见上）

### 测试

- 测试文件：`packages/*/**/*.test.ts`
- 单个 Vitest 运行器在根目录 (`vitest.config.ts`)，vitest 4.x
- 测试环境初始化在 `test/setup.ts`（HOME 隔离 + pi-ai/compat mock + 包状态重置 + 配置路径清理）
- `passWithNoTests: true` — 无测试不视为失败
- 移植包测试从上游整体搬运（65 文件 / 1039 用例），修改移植包代码必须保持测试全绿

### 版本管理

- 每个包独立维护版本号（不强制一致；按需只升有变动的包）
- `npm run version:patch|minor|major -- <包>` 升级指定包（按 SemVer 规范选择级别；参数用包目录名
  或 scoped 包名，例如 `npm run version:minor -- pi-ask-user-question`）
- `scripts/bump-version.mjs` 执行升级：只改目标包的 `version` 字段，随后把 workspace 内部依赖引用
  同步到当前版本，并保证 lockfile 与 manifest 一致（CI 的 `npm ci` 依赖）
- `scripts/sync-versions.js` 把各包 `dependencies`/`devDependencies` 中指向 workspace 兄弟包的版本
  同步为对应包的当前版本（`peerDependencies` 不动）

### 发布

发布脚本与 CI 都按「当前版本已发布则跳过、未发布则发布」逐包执行，`private: true` 的包永不发布
（如 pi-test-utils）。

CI 自动发布（push main 触发，`.github/workflows/publish.yml`）——**日常迭代的标准发布通道**：

- npm **Trusted Publishing（OIDC）** 认证，无需 token；每个包需在 npmjs.com 配置 Trusted Publisher
  （schovest / pi-package-mono / publish.yml）
- 逐包跳过已发布版本与 private 包
- 依赖 `package.json` 的 `repository` 字段与 GitHub 仓库匹配（所有包已配置）
- 工具链要求：Node ≥ 22.14、npm ≥ 11.5.1（CI 用 node 24）

本地发布（走 npm 账号认证，2FA 用浏览器认证流或 OTP）——**仅用于新包首次上线**（npm 上从未发布过）：

- `npm run publish:first` — 只发布从未发布过的包（新包首次上线）
- `npm run publish:dry` — 预演（不真正发布）
- `npm run publish` — 底层脚本的默认模式（发布当前版本未发布的包，可用于手动补发）
- 脚本：`scripts/publish-packages.mjs`（支持 `--otp <code>` / `NPM_OTP` 环境变量）

版本升级规范：代码变动后发布前必须升版，否则 CI/脚本会跳过已发布版本导致新代码不发布。

### 通用行为准则

1. **先思考再编码。** 明确陈述假设，不确定就问。有多种理解时全部列出。
2. **简洁优先。** 最小化代码解决问题，不做投机性工作。200 行能做但 50 行就够 → 重写。
3. **外科手术式变更。** 只改动必须改的，不"改进"无关代码。匹配现有风格。你的变更产生的死代码要清理。
4. **目标驱动执行。** 将任务转为可验证目标，循环直到验证通过。
