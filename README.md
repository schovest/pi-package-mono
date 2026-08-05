# pi-package-mono

[Pi Agent](https://github.com/badlogic/pi-mono) 扩展的单仓仓库。npm workspaces 管理，TypeScript 源码直出，无构建步骤。

## 包

| 包 | 用途 | npm |
| --- | --- | --- |
| `pi-mcp-adapter` | MCP (Model Context Protocol) 适配器 — 按需代理工具，懒加载连接，支持 OAuth、UI 集成 | [`@schovest/pi-mcp-adapter`](https://www.npmjs.com/package/@schovest/pi-mcp-adapter) |
| `pi-btw` | `/btw` 侧问命令 — 不污染主会话的一次性提问覆盖层 | [`@schovest/pi-btw`](https://www.npmjs.com/package/@schovest/pi-btw) |
| `pi-todo` | 模型的任务清单 — 实时覆盖层，`/reload` 与会话压缩后仍存活 | [`@schovest/pi-todo`](https://www.npmjs.com/package/@schovest/pi-todo) |
| `pi-ask-user-question` | 结构化问卷工具 — 类型化选项替代自由文本猜测 | [`@schovest/pi-ask-user-question`](https://www.npmjs.com/package/@schovest/pi-ask-user-question) |
| `pi-config` | 共享配置 I/O 工具 — XDG 路径解析、JSON 读写、TypeBox 校验 | [`@schovest/pi-config`](https://www.npmjs.com/package/@schovest/pi-config) |
| `pi-i18n` | 本地化基础 — 语言检测、`/languages` 命令、跨包语言注册表 | [`@schovest/pi-i18n`](https://www.npmjs.com/package/@schovest/pi-i18n) |
| `pi-test-utils` | 内部测试夹具（private，不发布） | [`@schovest/pi-test-utils`](https://www.npmjs.com/package/@schovest/pi-test-utils) |

`pi-btw`、`pi-todo`、`pi-ask-user-question`、`pi-config`、`pi-i18n`、`pi-test-utils` 基于 [@juicesharp/rpiv-*](https://github.com/juicesharp/rpiv-mono) 2.4.0 移植。

## 仓库结构

npm workspaces 单仓。克隆、`npm install` 到根目录即可。Node 20+。

关键约定：

- **无构建步骤。** 包直接发布原始 `.ts`；Pi 直接加载 TypeScript。没有 `dist/`，没有按包的 tsconfig。
- **根级 Vitest 运行器** 遍历所有包。没有按包的 vitest 配置。
- **单一共享配置：** 一个 `biome.json`、一个 `tsconfig.base.json`、一个 `vitest.config.ts`。
- **Lockstep 版本。** 所有工作区包共享同一版本，由 `scripts/sync-versions.js` 强制执行。
- **Biome 负责格式化和 Lint。** `npm run check` 一次性运行 biome + tsc。

### Scripts

| 命令 | 用途 |
| --- | --- |
| `npm run check` | Biome 格式化 + Lint + tsc 类型检查 |
| `npm run check:files` | 仅 Biome 格式化 + Lint |
| `npm test` | 运行所有测试 |
| `npm run coverage` | 测试 + 覆盖率报告 |
| `npm run version:patch` | Lockstep 小版本升级 |
| `npm run version:minor` | Lockstep 次版本升级 |
| `npm run version:major` | Lockstep 主版本升级 |
| `npm run publish` | 发布所有包（先执行 check） |
| `npm run publish:dry` | 预发布模拟 |

### CI

推送到 `main` 或 PR 时：`check` → `test` → `coverage`（Node 22 + 24）。

推送到 `main` 时还会触发自动发布：`check` → `test` → 逐包 `npm publish`。**已发布过的版本自动跳过**（不会重复发布）；`private` 包（如 `pi-test-utils`）不发布。不依赖 git tag。

## 版本升级规范

代码发生变动后，发布前需按 [SemVer](https://semver.org/lang/zh-CN/) 标准规范升级版本（lockstep，所有包同步）：

| 变动类型 | 命令 | 示例 |
| --- | --- | --- |
| 修复 bug、非行为性改动 | `npm run version:patch` | 0.1.2 → 0.1.3 |
| 新增向后兼容功能 | `npm run version:minor` | 0.1.2 → 0.2.0 |
| 破坏性变更 | `npm run version:major` | 0.1.2 → 1.0.0 |

升级命令会同步所有工作区包版本与内部依赖（`scripts/sync-versions.js`）。若代码有变动但未升版，CI 发布时会跳过已发布版本——**新代码不会被发布**，需先执行上述升级命令再推送。

## License

MIT
