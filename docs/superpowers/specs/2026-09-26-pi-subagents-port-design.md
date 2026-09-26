# 移植 nicobailon/pi-subagents v0.71.0 → @schovest/pi-subagents（定制 fork）

日期：2026-09-26
状态：已批准（2026-09-26，分节确认；决策矩阵见文末）

## 背景

用户要求将 [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) fork 一份迁入本仓
（`packages/pi-subagents` → `@schovest/pi-subagents`），并借 fork 做三点定制：

1. 上游发现子 agent 的来源过宽：`~/.agents` / `<root>/.agents` 两个目录被递归扫描
   （仅排除 `.agents/skills` 一种 legacy 路径），会把 skills、其他工具的 md 文件误解析成子 agent。
2. 内置（builtin）agent 中 6 个外部 CLI 适配器（claude-code/-writer、codex-exec/-writer、
   cursor-agent/-writer）对本用户无意义且占用上下文。
3. 期望的 agent 固定来源：项目级 `<root>/.pi/agents`、用户级 `~/.pi/agent/agents`（两者都是
   上游既有扫描目录，天然兼容），目录不存在时扩展正常空跑（只剩保留的 builtin + 其余来源）。

上游基线：**tag `v0.71.0`**（= npm latest 0.71.0，commit `03acb34`/`4af5e85`）。
HEAD 仅领先 1 个未发布 commit（`2e9c51b`，#2479，+1631/−242），不追。

上游概况：MIT；909 文件；`src/` 291 个 ts；`test/` 307 个测试文件（node:test +
`--experimental-strip-types` + 自定义 loader 隔离）+ 18 support + 188 fixtures；
根下 5 个运行时 `.mjs`；`pi` 字段声明 extensions + skills + prompts；`bin: pi-subagents → install.mjs`。

## 范围

### 搬运清单（`packages/pi-subagents/`）

| 内容 | 处理 |
| --- | --- |
| `src/`（291 ts）、`index.ts` | 整搬，fork 改动见下节 |
| 根下 `install.mjs`、`inspector-runner.mjs`、`async-retention-discovery-worker.mjs`、`runner-peer-loader.mjs`、`runner-peer-preload.mjs` | 整搬（运行时需要） |
| `agents/` | 搬 7 个：delegate、evidence-auditor、oracle、researcher、reviewer、scout、worker |
| `skills/`、`prompts/`、`docs/` | 整搬，fork 相关提及随改 |
| `test/`（unit 262 + integration 44 + smoke 16（1 test + 15 支撑）+ support 18 + fixtures 188） | 整搬并适配 vitest，见「测试适配」 |
| `CHANGELOG.md`、`LICENSE`、`README.md` | 搬，README/CHANGELOG 加 fork 说明，LICENSE 保留 Nico Bailon 版权署名 |

### 不搬

`package-lock.json`、`tsconfig.json`、`tsconfig.build.json`、`scripts/build-package.mjs`、
oxlint 配置、上游 `AGENTS.md`、`VISION.md`、`examples/`（无测试引用、不入 `files`）、
`banner.png`（README 用 GitHub 远端 URL）。

## Fork 定制改动（相对上游 v0.71.0 的全部 diff）

1. **删 6 个 builtin**：`agents/` 下 6 个 md（见上）；`src/agents/builtin-names.ts` 同步删 6 项。
   列表中的 `advisor` 是无定义文件的死条目，**不动**（外科手术原则）。
2. **删两个 legacy `.agents` 扫描源**：
   - `src/agents/agents.ts`：`userDirNew`（`~/.agents`）常量及 `userDir` 三态回退
     （简化为恒 `~/.pi/agent/agents`）；`resolveNearestProjectAgentDirs` 的 `legacyDir`；
     `isLegacyAgentSkillPath` 连带删除（仅为 `~/.agents` 扫描服务）。
   - src 内约 20 个文件的 `userDirNew`/`.agents` 显示与诊断引用随之清理（实施时以 grep 精确圈定）。
3. **其余一律不动**：保留 7 个 builtin；`<root>/.pi/agents`、`~/.pi/agent/agents`、npm package 源
   （项目 `.pi/npm/node_modules`、`~/.pi/agent/npm/node_modules`、全局 npm root、settings `packages`）、
   env `PI_SUBAGENT_EXTRA_AGENT_DIRS`、settings `agentScanDirs`/`agentExcludeDirs`（含通配符）、
   chains（`.pi/chains` / `~/.pi/agent/chains`）；扫描目录缺失时空跑正常。

新增 fork 行为测试：6 个 CLI 适配器 agent 不出现在发现结果；`~/.agents` 与 `<root>/.agents`
不被扫描（放置 md 后不影响发现结果与诊断）。

## 包适配（package.json）

- `name: @schovest/pi-subagents`，`version: 0.1.0`，`type: module`，公开包（无 `private`）。
- 保持上游：`exports` 子路径（`./background-work`、`./external-job-provider` 等 14 个，指向 `./src/api/*.ts`）、
  `pi.extensions/skills/prompts`、`bin: { "pi-subagents": "install.mjs" }`、keywords。
- `dependencies`：`acorn 8.18.0`、`jiti 2.7.0`、`undici 8.10.0`、`yaml 2.8.3`（上游精确版本）。
- `peerDependencies`：`pi-agent-core *`、`pi-ai >=0.86.1`、`pi-coding-agent *`、`pi-tui *`、`typebox *`，
  全部 optional（上游样式，`peerDependenciesMeta` 保留）。
- `devDependencies`：**嵌套 `@earendil-works/pi-{agent-core,ai,tui,coding-agent}@0.87.1`**
  （与用户本机 Pi 版本一致；其余 10 个包维持 root 0.80.5 不动）+ `typebox ^1.3.0`（与仓内其他包一致）+
  `@types/node 24.x`（沿上游假设）。
- `files`：`index.ts`、`src/**/*.ts`、`*.mjs`、`agents/`（裁后 7 个）、`skills/**/*`、`prompts/**/*`、
  `docs/**/*`、`README.md`、`CHANGELOG.md`、`LICENSE`；须与磁盘一致（`verifyShipManifest` 双向校验，
  新增 `ship-manifest.test.ts`）。
- `scripts` 清空（check/typecheck/test 由 root 统一管理）；`repository` 指 mono
  （`https://github.com/schovest/pi-package-mono.git`），`author` 省略（随 hermes/goal 先例，
  署名由 LICENSE 承担）。

## 仓级改动

- `tsconfig.base.json`：`target`/`lib` **ES2022 → ES2023**（上游 src 有 8 处 `findLast` 等 ES2023 API；
  本仓唯一全局改动，`npm run check` + 全量测试回归验证）。
- biome：整包格式化到仓风格（tabs → 2 空格、120 列；hermes 先例，接受与上游的空白 diff；
  语义、字符串字面量、`.ts` 导入后缀一律不动——上游本就用 `.ts` 后缀导入）。
- `test/setup.ts`：pi-ai mocks 保持全局；若 `completeSimple` stub 干扰移植测试，将该 stub 下放
  到 btw 自己的测试文件（实施时验证，并在实施计划中列为检查点）。
- 依赖落地：npm workspaces 嵌套安装（包内 0.87.1 与 root 0.80.5 共存）；lockfile 随 `npm install` 更新。

## 测试适配（node:test → vitest）

机械转换：

- `import { describe/it/test/before/after/beforeEach/afterEach } from "node:test"` → 同名自 `vitest`；
  `node:assert/strict` 保留不动。
- per-test `{ timeout }` 选项 → vitest 等价写法。

逐个改写（不能机械替换的部分）：

- node:test `mock` API（19 文件）→ `vi.fn`/`vi.spyOn`/`vi.mock` 等价改写。
- subtests（33 文件）→ 嵌套 describe/it 重排。
- loader 式隔离（`test/support/isolated-temp-root.mjs`、`register-loader.mjs` 等 node loader hooks）
  → vitest setup / 测试内临时目录方案重做；support 中 `.mjs` loader 文件随裁。

fork 行为裁剪与新增：

- 删 6 个 CLI 适配器相关用例（约 18 个测试文件涉及）。
- 删 `~/.agents` / `<root>/.agents` 发现用例（约 7 个测试文件涉及）。
- 新增「Fork 定制改动」节所述断言。

实施顺序（每阶段以全绿收口）：**unit 262 → integration 44 → smoke 1**
（smoke 拉真实 pi-coding-agent session，最重，放最后并预留时间余量）。

完成标准：`npm run check` + `npm run test` 在 CI node 22/24 矩阵全绿。

## 文档 / 版本 / 发布

- README：保留上游内容；顶部加 fork 说明（来源、基线 v0.71.0、三点定制）；删 6 个 CLI 适配器的
  提及；install 命令改 `pi install npm:@schovest/pi-subagents`。
- CHANGELOG：保留上游历史，追加 fork `0.1.0` 条目。
- 根 `AGENTS.md`：包表加行；新增「pi-subagents 移植约定」小节——基线 tag、三点定制清单、
  嵌套 0.87.1 devDeps 说明，防止未来同步上游时丢失定制。
- 版本：`0.1.0` 起步；CI trusted publishing 逐包发布；首次上线需在 npmjs.com 为该包配置
  Trusted Publisher（同 hermes/goal 流程），必要时本地 `npm run publish:first`。

## 决策矩阵

| 分歧点 | 选择 | 备选与否决理由 |
| --- | --- | --- |
| 上游基线 | tag v0.71.0 | HEAD 只多 1 个未发布 commit 且仍在变动；npm 装的 0.71.0 应与源码一致（hermes/goal 先例） |
| pi SDK 版本 | 本包嵌套 0.87.1，其余包维持 0.80.5 | 全仓升级影响 10 个包、超出范围；降级到 0.80.5 需大规模兼容层（上游要求 `pi-ai>=0.86.1`、41 文件用 `pi-agent-core`）不可行 |
| 测试运行器 | 全部适配 vitest | 保留 node:test 双 runner 破坏「单仓单 vitest」约定，且 biome/tsc 仍会扫到这 307 个文件，逃不掉适配成本 |
| 包版本 | 0.1.0 | 与 hermes 迁入后重置的先例一致 |
| 项目级目录 | `<root>/.pi/agents` | 用户定；`.pi/subagents` 与上游运行时状态/产物目录冲突，已避开 |
| 用户级目录 | `~/.pi/agent/agents` | 用户定；即上游 `userDirOld`，兼容存量用户 |

## 风险与对策

| 风险 | 对策 |
| --- | --- |
| 307 个测试适配量大，mock/subtest/loader 改写有语义风险 | 分阶段（unit→integration→smoke），每阶段全绿收口；mock/subtest 逐个人工改写不批量盲替 |
| root setup 的 pi-ai stub 与移植测试互相干扰 | 先全局跑，冲突时把 `completeSimple` stub 下放 btw 测试 |
| 嵌套 0.87.1 与 root 0.80.5 双版本解析歧义 | vitest/tsc 均从包目录就近解析；实施早期先跑 smoke 验证解析路径 |
| upstream 后续同步（rebase 上游新版本）会撞定制与格式化 | 根 AGENTS.md 记录定制清单与基线 tag；同步时按清单重放 |
| smoke 测试耗时长/资源重 | 放最后阶段；必要时单独超时预算，不在 unit 阶段拉入 |

## 验收清单

- [ ] `packages/pi-subagents/` 按搬运清单就位，`agents/` 恰为 7 个 builtin
- [ ] `builtin-names.ts` 无 6 个 CLI 适配器；`userDirNew`/`legacyDir`/`isLegacyAgentSkillPath` 无残留引用
- [ ] `npm run check` 全绿（含新包 biome/tsc）
- [ ] `npm run test` 全绿（新增 fork 行为用例通过；node 22/24）
- [ ] `ship-manifest.test.ts` 通过（files ↔ 磁盘双向一致）
- [ ] README/CHANGELOG/根 AGENTS.md 更新
- [ ] 版本 0.1.0 发布（Trusted Publisher 配置完成后）
