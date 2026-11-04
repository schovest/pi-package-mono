# 移植 Masterisk-F/pi-compact-display（master b3f6db1）→ @schovest/pi-compact-display

日期：2026-10-28
状态：已批准（2026-10-28；含 builder check 两项定夺与实施期 noUselessElse Ruling）

## 背景

用户要求将 [Masterisk-F/pi-compact-display](https://github.com/Masterisk-F/pi-compact-display)
fork 一份迁入本仓（`packages/pi-compact-display` → `@schovest/pi-compact-display`）。

功能：按工具粒度定制 Pi TUI 的工具输出渲染——摘要行（`⚡ read(1) ls(2)`）、行数限制、
去 padding、grouping 聚合（`⚡ bash ×3`）、隐藏 thinking 指示器、支持第三方扩展工具、
完整支持 Ctrl+O 展开。只注册 renderer（`pi.registerToolRenderer()`，要求 Pi ≥ 1.0.1），
不替换 tool 执行；`mode: "default"` 经 `next()` 委托既有 renderer。

两个用户已确认的决策：

1. **基线 = master HEAD `b3f6db1`**（不是已发布的 v1.5.0 tag）。master 领先 tag 一个
   已合并未发布的修复（PR #9 renderer-only 兼容：`index.ts` +92 行、`tools.ts` ±198 行，
   改用 renderer resolvers 而非替换 tool 执行）。npm tarball 仅含 `dist/` 编译产物，
   无源码，不可作基线。
2. **许可证**：上游 `LICENSE` 文件实为 **GPL-3.0**（npm package.json 字段误标 ISC，
   系上游笔误）。用户接受以 GPL-3.0 收录并对外发布。

## 上游概况（master b3f6db1）

- `src/` 10 个 ts（约 984 行）：componentUtils、config、contextUtils、group、index、
  renderUtils、sanitize、state、tools、uiUtils
- `tests/` 17 个 vitest 测试文件 + `renderingHarness.ts`（约 2357 行）
- **零运行时依赖**；`peerDependencies`：`@earendil-works/pi-coding-agent *`、
  `@earendil-works/pi-tui *`；devDeps 锁 `^1.0.1`
- 相对导入**无扩展名**（bundler 解析）→ 见「源码适配」
- 上游 `vitest.config.ts` 设 `env: { COLORTERM: 'truecolor' }`（colorize 渲染测试依赖）
- npm 包发布 `dist/`（tsc 构建产物）→ 本仓改为源码发布，不搬构建链

## 范围

### 搬运清单（`packages/pi-compact-display/`）

| 内容 | 处理 |
| --- | --- |
| `src/`（10 ts） | 整搬；唯一系统性源码适配 = 相对导入补 `.ts` 后缀，其余逐字节不动 |
| `tests/`（17 测试 + renderingHarness） | 整搬适配 root vitest core project；相对导入同补 `.ts`；`COLORTERM` 见「测试适配」 |
| `README.md`、`README_ja.md` | 保留；安装命令改为 `pi install npm:@schovest/pi-compact-display`；文首加 fork 基线说明（master b3f6db1，GPL-3.0） |
| `LICENSE` | GPLv3 全文 + Masterisk-F 版权署名，原样保留 |

### 不搬

`package-lock.json`、`tsconfig.json`、`vitest.config.ts`（env 移入 harness）、
`.github/workflows/publish.yml`、`screenshot1.png`（README 用 GitHub 远端 URL）、
`package.json` 的 `build`/`test` scripts（root 统一管理）。

## 源码适配（相对上游的全部实质改动）

1. **相对导入补 `.ts` 后缀**：root `tsconfig.base.json` 是 `moduleResolution: NodeNext`
   + `allowImportingTsExtensions`，无扩展名相对导入直接报 TS2835。补后缀是仓内
   非移植包的主流风格；jiti 运行时（宿主 pi 加载 `.ts` 入口）原生支持。
   不改 root moduleResolution（影响全仓），不给 root tsc 加排除（破坏「src 全量
   类型检查」约定）。
2. **`COLORTERM=truecolor`**：从上游 vitest.config env 移到 `tests/renderingHarness.ts`
   顶部（`process.env.COLORTERM ??= 'truecolor'`）；实施时验证 colorize 单测是否也依赖
   （是则同样处理或在测试文件顶部设置）。不改 root vitest.config（不为单包加 env）。
3. **biome 规范化重排**（builder check 定夺）：上游 src/tests 为 tab 缩进 + 引号混用，
   root `npm run check` 的 biome 门禁（space×2 / 双引号 / 120 列）必然成片重写。
   按 rpiv 六包移植先例接受重排；**diff 审阅口径 = `git diff -w`（忽略空白）对照上游，
   实质改动仅限「后缀 + env」两类，逻辑零改动**。不给本包加 biome ignore
   (动 root 配置且成为全仓唯一例外)。
4. **测试类型就地修**（builder check 定夺）：上游 tsconfig 只含 `src/**/*`，17 个测试文件
   从未被 tsc 检查过；root strict tsc 会检查它们。按 pi-hermes-memory 先例**就地补齐测试类型**
   （保持「root 配置不动」承诺）；类型修正是纯类型层适配，不算逻辑改动。仅当发现结构性
   大面积类型债（subagents 量级）时升级为 root tsc exclude 方案，且须回头与用户确认。
5. **其余一律不动**：逻辑、配置键（`~/.pi/agent/extensions/pi-compact-display/config.json`）等。

## 包适配（package.json）

- `name: @schovest/pi-compact-display`，`version: 0.1.0`（版本线自起，pi-goal 先例），
  `type: module`，公开包（无 `private`）。
- `pi.extensions: ["./src/index.ts"]`（源码发布，全部既有包同款）。
- `peerDependencies`：`@earendil-works/pi-coding-agent *`、`@earendil-works/pi-tui *`
  （上游样式；Pi ≥ 1.0.1 由扩展自身运行时检查兜底并给出升级提示）。
- `devDependencies`：**嵌套 `@earendil-works/pi-coding-agent@1.4.0` + `@earendil-works/pi-tui@1.4.0`**
  （精确版本；root 0.80.5 无 `registerToolRenderer`，本包类型检查需 ≥1.0.1，取 npm latest 1.4.0，
  即上游 dev 约束 `^1.0.1` 的当前满足版。与 root 0.80.5、pi-subagents 嵌套 0.87.1 三线并存，
  **勿混升**，AGENTS.md 记录）+ `@types/node ^26`（沿上游；npm 自动嵌套，与 root 22.20.1 并存，
  若类型冲突实施时降 22）。
- `files: ["src", "README.md", "README_ja.md", "LICENSE"]`（无 dist）。
- `license: "GPL-3.0-only"`（npm 字段用 SPDX；上游字段 ISC 是笔误，不跟随；LICENSE 文件为准）。
- `repository` 指 mono（`https://github.com/schovest/pi-package-mono.git`）；`author` 省略
  （署名由 LICENSE 承担，goal/hermes/subagents 先例）；`scripts` 清空；keywords 保留 `pi-package`。

## 仓级改动

- root `package.json` / `vitest.config.ts` / `tsconfig.base.json` / `test/setup.ts` **均不动**
  （core project glob `packages/*/**/*.test.ts` 已覆盖新测试；HOME 隔离对其无害且有益）。
- `AGENTS.md`：包表加一行；新增「pi-compact-display 移植约定」段（基线 master b3f6db1
  与 v1.5.0 差异、GPL-3.0、嵌套 1.4.0 勿混升、`.ts` 后缀适配、上游只发 dist）。
- 发布：走既有 CI Trusted Publishing 通道；**手工前置**：npmjs.com 为
  `@schovest/pi-compact-display` 配 Trusted Publisher（schovest / pi-package-mono / publish.yml）。
- 首发用本地 `npm run publish:first`（新包首次上线通道）或配好 Trusted Publisher 后 push main。

## 验证

1. `npm install` 后 `npm run check` 全绿（biome 两遍 0 fixes + `tsc --noEmit -p tsconfig.base.json`）。
2. `npx vitest run packages/pi-compact-display` 全绿；用例数与上游逐文件对齐（17 文件）。
3. 与上游 diff 审阅：`git diff -w` 对照上游（忽略空白），实质改动仅限导入后缀 + harness env
   + 测试类型修正三类；biome 重排不视为实质 diff。

## 决策矩阵

| 决策 | 选择 | 落选方案与理由 |
| --- | --- | --- |
| 基线 | master b3f6db1（用户定） | v1.5.0 tag：落后一个兼容修复；npm tarball：无源码 |
| 导入后缀 | 补 `.ts` | 保持无后缀须 tsc 排除或改 root 解析，均破坏仓约定 |
| 发布形态 | 源码（`src/index.ts` 入口） | 上游 dist 形态：与本仓 12 包惯例冲突，且引入构建链 |
| License 字段 | `GPL-3.0-only` | 沿上游 `ISC`：与 LICENSE 文件矛盾，属上游笔误 |

## 风险 / 开放问题

- pi-tui 1.4.0 在 vitest 无头环境渲染：上游 CI 即 vitest 跑同款测试，预期直接过；
  若有 TTY 依赖由 renderingHarness 吸收。
- 嵌套 `@types/node` 26 与 root 22 并存：npm workspace 支持嵌套，实施时验证类型检查。
