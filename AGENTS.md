# AGENTS.md

Pi 扩展单仓的行为准则。与通用指南叠加使用。

## 项目约定

### 包结构

- 每个 `packages/<name>/` 是一个独立的 Pi 扩展
- 扩展入口由 `package.json` 的 `pi.extensions` 声明
- 发布原始 `.ts` 源码，不做构建
- 所有包共享 lockstep 版本号

### 代码风格

- TypeScript strict 模式
- 2 空格缩进，120 字符行宽
- Biome 负责格式化和 lint（配置在根 `biome.json`）
- 导入使用 `.ts` 扩展名（`from "./foo.ts"`）

### 测试

- 测试文件：`packages/*/**/*.test.ts`
- 单个 Vitest 运行器在根目录 (`vitest.config.ts`)
- 测试环境初始化在 `test/setup.ts`
- `passWithNoTests: true` — 无测试不视为失败

### 版本管理

- Lockstep 版本：所有包使用同一版本号
- `npm run version:patch|minor|major` 统一升级
- `scripts/sync-versions.js` 强制执行版本一致并同步内部依赖

### 通用行为准则

1. **先思考再编码。** 明确陈述假设，不确定就问。有多种理解时全部列出。
2. **简洁优先。** 最小化代码解决问题，不做投机性工作。200 行能做但 50 行就够 → 重写。
3. **外科手术式变更。** 只改动必须改的，不"改进"无关代码。匹配现有风格。你的变更产生的死代码要清理。
4. **目标驱动执行。** 将任务转为可验证目标，循环直到验证通过。
