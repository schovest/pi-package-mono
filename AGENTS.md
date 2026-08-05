# AGENTS.md

Pi 扩展单仓的行为准则。与通用指南叠加使用。

## 项目约定

### 包结构

- 每个 `packages/<name>/` 是一个独立的 Pi 扩展
- 扩展入口由 `package.json` 的 `pi.extensions` 声明
- 发布原始 `.ts` 源码，不做构建
- 所有包共享 lockstep 版本号

当前包（10 个）：

| 包 | 说明 | 发布 |
| --- | --- | --- |
| `pi-btw` | `/btw` 侧问命令（底部面板，答案不落盘） | ✅ |
| `pi-todo` | `todo` 工具 + `/todos` 命令 + 实时覆盖层（存活 compaction） | ✅ |
| `pi-ask-user-question` | `ask_user_question` 分页签对话框工具 | ✅ |
| `pi-config` | 共享配置 I/O（configPath/loadJsonConfig 等） | ✅ |
| `pi-i18n` | 本地化基础（locale 检测、/loader 子路径、软可选） | ✅ |
| `pi-test-utils` | 测试夹具（verifyShipManifest、mock Pi 等） | ❌ private |
| `pi-goal` | goal 自主编排扩展 | ✅ |
| `pi-mcp-adapter` | MCP 适配器 | ✅ |
| `pi-sudo-helper` | sudo 密码注入 | ✅ |
| `pi-tps` | tokens-per-second 监控 | ✅ |

`pi-btw`/`pi-todo`/`pi-ask-user-question`/`pi-config`/`pi-i18n` 基于
[@juicesharp/rpiv-* 2.4.0](https://github.com/juicesharp/rpiv-mono) 全量移植。
**移植约定（不可破坏）**：相对导入保留上游 `.js` 后缀（`./config.js`）；
`rpiv-*` 字符串字面量（配置路径 `~/.config/rpiv-*`、`Symbol.for("rpiv-*")`、组件 key）原样保留，
改了就破坏行为/迁移；LICENSE 保留上游 juicesharp 版权署名。

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

- Lockstep 版本：所有包使用同一版本号
- `npm run version:patch|minor|major` 统一升级（按 SemVer 规范选择级别）
- `scripts/sync-versions.js` 强制执行版本一致并同步内部依赖

### 发布

本地发布（走 npm 账号认证，2FA 用浏览器认证流或 OTP）：

- `npm run publish` — 发布 `private: false` 且**当前版本未发布**的包（日常迭代）
- `npm run publish:first` — 只发布**从未发布过**的包（新包首次上线）
- `npm run publish:dry` — 预演（不真正发布）
- 脚本：`scripts/publish-packages.mjs`（支持 `--otp <code>` / `NPM_OTP` 环境变量）

CI 自动发布（push main 触发，`.github/workflows/publish.yml`）：

- npm **Trusted Publishing（OIDC）** 认证，无需 token；每个包需在 npmjs.com 配置 Trusted Publisher
  （schovest / pi-package-mono / publish.yml）
- 逐包跳过已发布版本与 private 包
- 依赖 `package.json` 的 `repository` 字段与 GitHub 仓库匹配（所有包已配置）
- 工具链要求：Node ≥ 22.14、npm ≥ 11.5.1（CI 用 node 24）

版本升级规范：代码变动后发布前必须升版，否则 CI/脚本会跳过已发布版本导致新代码不发布。

### 通用行为准则

1. **先思考再编码。** 明确陈述假设，不确定就问。有多种理解时全部列出。
2. **简洁优先。** 最小化代码解决问题，不做投机性工作。200 行能做但 50 行就够 → 重写。
3. **外科手术式变更。** 只改动必须改的，不"改进"无关代码。匹配现有风格。你的变更产生的死代码要清理。
4. **目标驱动执行。** 将任务转为可验证目标，循环直到验证通过。
