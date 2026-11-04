# pi-compact-display 移植 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Masterisk-F/pi-compact-display(master `b3f6db1`)整搬为 `packages/pi-compact-display`(`@schovest/pi-compact-display@0.1.0`),`npm run check` 与新包 17 个测试文件全绿,逻辑零改动。

**Architecture:** 纯移植:上游 src/tests 复制后做四类实质适配(相对导入补 `.ts` 后缀、`COLORTERM` 移入 harness、biome 重排、测试类型就地修),包以源码发布(`pi.extensions: ./src/index.ts`),root 配置零改动,依赖靠 package 级嵌套 devDeps 解决版本线冲突。

**Tech Stack:** TypeScript(NodeNext strict)、vitest 4(root core project)、biome 1.9.4、@earendil-works/pi-coding-agent@1.4.0(嵌套)、@earendil-works/pi-tui@1.4.0(嵌套)。

**Spec:** `docs/superpowers/specs/2026-10-28-pi-compact-display-port-design.md`(已批准)

## Global Constraints

- 上游基线 = master `b3f6db1`(`/tmp/pi-compact-display`,missing 时按下述命令重克隆)
- **逻辑零改动**:与上游的实质 diff 仅限四类——导入 `.ts` 后缀、`COLORTERM` env、biome 格式重排、测试类型修正
- **root 配置零改动**:`package.json`、`vitest.config.ts`、`tsconfig.base.json`、`test/setup.ts`、`biome.json` 一律不动
- 不搬:上游 `tsconfig.json`、`vitest.config.ts`、`package-lock.json`、`.github/`、`screenshot1.png`、`build`/`test` scripts
- `LICENSE` 原样保留 GPLv3 全文与 Masterisk-F 署名;`package.json` 的 `license` 字段 = `GPL-3.0-only`
- devDeps 精确版本:`@earendil-works/pi-coding-agent` `1.4.0`、`@earendil-works/pi-tui` `1.4.0`(嵌套,勿并入 root 0.80.5 / pi-subagents 0.87.1 任何一线)
- 版本线自起 `0.1.0`;包名 `@schovest/pi-compact-display`
- 逻辑改动豁免上限:测试类型修正只做**类型层**(注解/断言收窄/`as` 收窄),发现需改运行时逻辑才能过的情况 → 停下报告,不得改

## Review Focus

1. **COLORTERM 缺失 → colorize/渲染断言静默劣化**:harness 覆盖不到的测试文件(如 `renderUtils.colorize*.test.ts`)若断言依赖真彩 ANSI,须逐文件补 env(Task 3 验证覆盖)。
2. **测试类型修正滑向运行时改动**:strict tsc 下"顺手"改断言或 harness 行为会让测试失真——豁免上限见 Global Constraints(Task 2)。
3. **@types/node 26 与 root 22 并存的解析错位**:若 tsc 报 node API 类型错且源自类型版本差,降级方案 = 包 devDep 改 `22.x`,不得动 root(Task 2)。
4. **嵌套依赖未真正嵌套**(npm 把 1.4.0 提升覆盖 root 0.80.5):安装后必须核对 `packages/pi-compact-display/node_modules` 布局与 root 版本未变(Task 2)。
5. **后缀补写遗漏动态导入或类型导入**:sed 只匹配 `from '...'` 形态,收尾用 grep 全量验证无残留无后缀相对导入(Task 1)。

---

### Task 1: 搬运文件 + 静态适配 + 包元数据

**Files:**
- Create: `packages/pi-compact-display/src/*.ts`(10 个,自上游复制)
- Create: `packages/pi-compact-display/tests/*.ts`(17 测试 + `renderingHarness.ts`,自上游复制)
- Create: `packages/pi-compact-display/package.json`、`LICENSE`(自上游复制)、`README.md`、`README_ja.md`(复制后两处编辑)

**Interfaces:**
- Produces: `packages/pi-compact-display/package.json`(精确内容见 Step 5),后续所有任务的安装/测试/检查均依赖它。

- [ ] **Step 1: 确认上游检出**

```bash
test -d /tmp/pi-compact-display/.git && git -C /tmp/pi-compact-display rev-parse HEAD
```

Expected HEAD = `b3f6db1...`(以 `b3f6db1` 开头,即 master)。不满足则:

```bash
git clone https://github.com/Masterisk-F/pi-compact-display.git /tmp/pi-compact-display
git -C /tmp/pi-compact-display checkout b3f6db1
```

- [ ] **Step 2: 复制源码、测试与文档**

```bash
cd /data/mine/pi-package-mono
mkdir -p packages/pi-compact-display
cp -r /tmp/pi-compact-display/src packages/pi-compact-display/src
cp -r /tmp/pi-compact-display/tests packages/pi-compact-display/tests
cp /tmp/pi-compact-display/LICENSE packages/pi-compact-display/LICENSE
cp /tmp/pi-compact-display/README.md /tmp/pi-compact-display/README_ja.md packages/pi-compact-display/
```

不复制:`tsconfig.json`、`vitest.config.ts`、`package.json`(自写)、`package-lock.json`、`.github/`、`screenshot1.png`。
验证:`ls packages/pi-compact-display/src | wc -l` = 10;`ls packages/pi-compact-display/tests/*.test.ts | wc -l` = 17,另有 `renderingHarness.ts`。

- [ ] **Step 3: 相对导入补 `.ts` 后缀(src + tests 全部文件)**

```bash
cd packages/pi-compact-display
grep -rl "from '[./]\|from \"[./]" src tests | xargs sed -i -E "s/(from ['\"])(\.{1,2}\/[^'\"]+)(['\"])/\1\2.ts\3/g"
```

验证(应无输出):

```bash
grep -rn "from ['\"]\." src tests | grep -v "\.ts['\"]"
```

同时确认未误伤包导入:`grep -rn "from '\./.*\.ts\.ts" src tests`(应无输出)。

- [ ] **Step 4: COLORTERM 移入 harness**

`tests/renderingHarness.ts` 顶部(`import` 语句之前)插入一行:

```ts
process.env.COLORTERM ??= 'truecolor';
```

(colorize 单测是否也依赖 env 由 Task 3 实测,缺则同法补到对应文件顶部。)

- [ ] **Step 5: 写 `packages/pi-compact-display/package.json`**

```json
{
  "name": "@schovest/pi-compact-display",
  "version": "0.1.0",
  "description": "Compact display extension for Pi tools.",
  "repository": {
    "type": "git",
    "url": "https://github.com/schovest/pi-package-mono.git"
  },
  "keywords": ["pi-package"],
  "license": "GPL-3.0-only",
  "type": "module",
  "files": ["src", "README.md", "README_ja.md", "LICENSE"],
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "1.4.0",
    "@earendil-works/pi-tui": "1.4.0",
    "@types/node": "^26"
  }
}
```

(无 `scripts`、无 `author`、无 `private`;description 沿上游。)

- [ ] **Step 6: README 两处编辑**

`README.md` 与 `README_ja.md` 同样处理:
1. 标题行之后插入引用块:`> Fork of [Masterisk-F/pi-compact-display](https://github.com/Masterisk-F/pi-compact-display) (master b3f6db1, GPL-3.0), maintained as @schovest/pi-compact-display.`
2. `pi install npm:pi-compact-display` → `pi install npm:@schovest/pi-compact-display`。
其余内容(含 "From Source" 的 build 说明)不动——上游文档原样保留,surgical 原则。

- [ ] **Step 7: Commit**

```bash
git add packages/pi-compact-display
git commit -m "feat(pi-compact-display): port upstream master b3f6db1 (src/tests/license/readme, .ts import suffixes, nested pi-* 1.4.0)"
```

### Task 2: 安装依赖 + tsc 全绿

**Files:**
- Modify: `package-lock.json`(npm 自动)
- Modify: `packages/pi-compact-display/src|tests/**/*.ts`(仅类型层修正)

**Interfaces:**
- Consumes: Task 1 的 package.json(devDeps 嵌套 1.4.0)。

- [ ] **Step 1: 安装**

```bash
cd /data/mine/pi-package-mono && npm install
```

- [ ] **Step 2: 核对嵌套布局(root 版本未被覆盖)**

```bash
node -e "console.log(require('./node_modules/@earendil-works/pi-coding-agent/package.json').version)"
node -e "console.log(require('./packages/pi-compact-display/node_modules/@earendil-works/pi-coding-agent/package.json').version)"
```

Expected: 第一条 `0.80.5`,第二条 `1.4.0`。若第二条报找不到(被提升合并)→ 停下报告,不得继续。

- [ ] **Step 3: tsc 循环至全绿**

```bash
npx tsc --noEmit -p tsconfig.base.json
```

仅修 `packages/pi-compact-display/**` 的报错,只做类型层修正(注解、参数类型、`as` 收窄、缺类型导入);src 理应零错误(上游 tsc 检查过,仅后缀差异)。若 src 报非后缀类错误、或测试类型债为结构性大面积、或需改运行时逻辑 → 停下报告。
node API 类型错疑似 @types 版本差 → 按 Review Focus 3 把包 devDep `@types/node` 降为 `^22` 重装。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(pi-compact-display): settle deps and strict-tsc test typings (type-level only)"
```

(若 Step 3 无任何类型修正且 lockfile 无变化,跳过本 commit。)

### Task 3: 新包测试全绿

**Files:**
- Modify: `packages/pi-compact-display/tests/renderingHarness.ts` 或个别测试文件顶部(仅 COLORTERM 类 env 补齐,如需)

- [ ] **Step 1: 跑新包测试**

```bash
npx vitest run packages/pi-compact-display
```

Expected: 17 个文件全 PASS。失败分类处理:
- 颜色/ANSI 断言差异 → 失败文件顶部补 `process.env.COLORTERM ??= 'truecolor';` 后重跑
- 其他失败 → 先查是否 Task 1/2 适配引入(后缀、类型修正);确非适配问题则停下报告,不得改测试断言凑绿

- [ ] **Step 2: 用例数对齐上游**

```bash
npx vitest run packages/pi-compact-display 2>&1 | tail -5
```

记录 tests 数并与上游基线核对:`cd /tmp/pi-compact-display && npx vitest run 2>&1 | tail -5`(上游环境跑一次作对照),两者 test/skipped 计数应一致(上游自身 skip 除外)。

- [ ] **Step 3: Commit(如有 env 补齐)**

```bash
git add packages/pi-compact-display/tests
git commit -m "test(pi-compact-display): pin COLORTERM for color-assertion files"
```

### Task 4: 全仓门禁

- [ ] **Step 1: check(biome 会重排本包为 space×2/双引号/120 列,属预期第三类适配)**

```bash
npm run check && npm run check
```

第二遍确认 0 fixes(rpiv 移植坑:重排后残留需第二遍清零)。Expected: 两遍均退出码 0。

- [ ] **Step 2: 全仓测试(确认新测试入 core project 且不破坏既有包)**

```bash
npm test
```

Expected: 全绿,含新增 17 个文件。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "style(pi-compact-display): biome normalization (no logic changes)"
```

(check 后无变更则跳过。)

### Task 5: 逻辑保真审计(diff -w 对照上游)

- [ ] **Step 1: 逐文件审计**

```bash
cd /data/mine/pi-package-mono
for f in $(ls packages/pi-compact-display/src) ; do
  echo "=== src/$f ==="; git diff --no-index -w /tmp/pi-compact-display/src/$f packages/pi-compact-display/src/$f || true
done
```

tests 同理(目录)。逐 hunk 确认:可接受 = 格式(缩进/引号/换行)、`.ts` 后缀、`COLORTERM` 行、纯类型注解;**出现任何其他 hunk = 违反 Global Constraints,回退该改动并查明原因**。

- [ ] **Step 2: 报告审计结论**(每个文件一行:接受 hunk 类别;零逻辑差异确认)

### Task 6: AGENTS.md 更新 + 设计文档收尾

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-10-28-pi-compact-display-port-design.md`(状态行)

- [ ] **Step 1: AGENTS.md 包表**

「当前包(12 个)」→「当前包(13 个)」,表尾追加行:

```markdown
| `pi-compact-display` | 按工具定制 TUI 工具输出渲染(摘要行/限行/grouping/hideThinking,renderer-only) | ✅ |
```

- [ ] **Step 2: AGENTS.md 移植约定段**(追加在 pi-subagents 定制改动清单之后)

```markdown
`pi-compact-display` 迁移自 [Masterisk-F/pi-compact-display](https://github.com/Masterisk-F/pi-compact-display)
master b3f6db1(领先已发布 v1.5.0 一个未发布修复 PR #9 renderer-only 兼容;npm 包只发 dist,不可作基线)。
**移植约定**:`LICENSE` 实为 **GPL-3.0**(npm 元数据误标 ISC),package.json 用 `GPL-3.0-only`,GPLv3 全文与
Masterisk-F 署名原样保留;相对导入补 `.ts` 后缀(root NodeNext 必需);上游 vitest.config 的
`COLORTERM=truecolor` 移入 tests/renderingHarness.ts;接受 biome 全量重排,逻辑保真以 `git diff -w` 对照上游;
测试类型就地修(hermes 先例)。**依赖**:包 devDeps 嵌套 `@earendil-works/pi-{coding-agent,tui}@1.4.0`
(精确;本包需 ≥1.0.1 的 `registerToolRenderer`),与 root 0.80.5、pi-subagents 嵌套 0.87.1 三线并存,
勿混升;`@types/node ^26` 嵌套(root 22.20.1 不动)。
```

- [ ] **Step 3: 设计文档状态行改为** `状态：已批准（2026-10-28，含 builder check 两项定夺）`

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-10-28-pi-compact-display-port-design.md
git commit -m "docs: register pi-compact-display port conventions in AGENTS.md"
```

- [ ] **Step 5: 收尾汇报**(发布为用户手工门槛:npmjs 为 `@schovest/pi-compact-display` 配 Trusted Publisher 后,首发 `npm run publish:first` 或 push main 走 CI)
