# pi-package-mono

[Pi Agent](https://github.com/badlogic/pi-mono) 扩展的单仓仓库。npm workspaces 管理，TypeScript 源码直出，无构建步骤。

## 包

| 包 | 用途 | npm |
| --- | --- | --- |
| `pi-mcp-adapter` | MCP (Model Context Protocol) 适配器 — 按需代理工具，懒加载连接，支持 OAuth、UI 集成 | [`@schovest/pi-mcp-adapter`](https://www.npmjs.com/package/@schovest/pi-mcp-adapter) |

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

推送到 `main` 或 PR 时：`check` → `test` → `coverage`（Node 20 + 22）。

推送 `v*` 标签时：`check` → `test` → `npm publish`。

## License

MIT
