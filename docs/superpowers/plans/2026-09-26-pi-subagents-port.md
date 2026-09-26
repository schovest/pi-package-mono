# pi-subagents 移植（v0.71.0 定制 fork）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 nicobailon/pi-subagents tag v0.71.0 整体迁入 `packages/pi-subagents`（`@schovest/pi-subagents@0.1.0`），施加三点定制（删 6 个 CLI 适配器 builtin；删 `~/.agents` 与 `<root>/.agents` 两个 legacy 发现源；其余发现源不动），307 个测试全部适配 vitest 并全绿。

**Architecture:** 先整搬上游源码 → 包 manifest/仓配置落地（嵌套 pi-*@0.87.1 devDeps、root tsconfig ES2023、vitest projects 拆分）→ 施加 fork src 改动并新增 fork 行为测试 → 按 unit/integration/smoke 三阶段把 node:test 测试转换成 vitest → ship-manifest 与文档收尾。

**Tech Stack:** TypeScript (strict, Node16 resolution, `.ts` 导入后缀)、vitest 4 (projects)、biome 1.9.4、npm workspaces。

**Spec:** `docs/superpowers/specs/2026-09-26-pi-subagents-port-design.md`（本计划从 spec 论证，执行者须同读）

## Global Constraints

- 上游基线：tag `v0.71.0`（GitHub tarball，不是 main HEAD）。
- 包名/版本：`@schovest/pi-subagents`，`0.1.0`，公开包（无 `private`）。
- 本包 devDeps 固定 `@earendil-works/pi-{agent-core,ai,tui,coding-agent}@0.87.1`；其余 10 个包维持 root 0.80.5，**不得改动其他包的 package.json**。
- 仓级全局改动仅限：`tsconfig.base.json`（ES2023）与 `vitest.config.ts`（projects 拆分）。
- 相对导入保留上游 `.ts` 后缀原样；语义/字符串字面量不改；biome 格式化（2 空格、120 列）一次性施加，仅空白 diff 可接受。
- LICENSE 保留 Nico Bailon 版权署名，不删改。
- fork 三点定制外的行为 100% 保留（含 chains、npm package 源、`PI_SUBAGENT_EXTRA_AGENT_DIRS`、settings `agentScanDirs`/`agentExcludeDirs`、其余 7 个 builtin）。
- 每个任务以 scoped 验证命令收口并 commit；最终以 `npm run check` + `npm test` 全绿收口。
- 临时脚本放 `/tmp`，不进仓。

---

### Task 1: 搬运上游 tag v0.71.0

**Files:**
- Create: `packages/pi-subagents/**`（自上游 tarball）
- Delete（搬运后剔除）: `packages/pi-subagents/{package.json,package-lock.json,tsconfig.json,tsconfig.build.json,AGENTS.md,VISION.md,examples/,scripts/,banner.png}`

**Interfaces:**
- Produces: 完整上游源码树（src 291 ts、test 528 文件、agents 13 md、根 5 个 .mjs、docs/skills/prompts），供后续所有任务加工。

- [ ] **Step 1: 下载并解包 tag tarball**

```bash
cd /tmp && rm -rf pi-sub-0.71.0 && mkdir pi-sub-0.71.0 && curl -sL https://github.com/nicobailon/pi-subagents/archive/refs/tags/v0.71.0.tar.gz | tar xz -C pi-sub-0.71.0 --strip-components=1
mkdir -p /data/mine/pi-package-mono/packages/pi-subagents
rsync -a /tmp/pi-sub-0.71.0/ /data/mine/pi-package-mono/packages/pi-subagents/
```

- [ ] **Step 2: 剔除不搬文件**

```bash
cd /data/mine/pi-package-mono/packages/pi-subagents
rm -rf package.json package-lock.json tsconfig.json tsconfig.build.json AGENTS.md VISION.md examples scripts banner.png
ls -A   # 人工核对剩余：index.ts、5 个 *.mjs、agents/ skills/ prompts/ docs/ src/ test/ CHANGELOG.md LICENSE README.md（无其他隐藏文件）
```

- [ ] **Step 3: 核对数量**

Run: `cd /data/mine/pi-package-mono/packages/pi-subagents && find agents -name '*.md' | wc -l && find src -name '*.ts' | wc -l && find test -name '*.test.ts' | wc -l && ls *.mjs | wc -l`
Expected: `13`、`291`、`307`、`5`

- [ ] **Step 4: Commit**

```bash
cd /data/mine/pi-package-mono && git add packages/pi-subagents && git commit -m "feat(pi-subagents): 搬运 nicobailon/pi-subagents v0.71.0 源码（未接线）"
```

---

### Task 2: 包 manifest + 仓配置 + 依赖落地

**Files:**
- Create: `packages/pi-subagents/package.json`
- Modify: `tsconfig.base.json`（target/lib ES2022 → ES2023）

**Interfaces:**
- Produces: `@schovest/pi-subagents` workspace 包；嵌套 0.87.1 解析路径；ES2023 编译基线（后续所有任务依赖）。

- [ ] **Step 1: 写入 package.json（完整内容，勿改字段）**

```json
{
  "name": "@schovest/pi-subagents",
  "version": "0.1.0",
  "description": "Pi extension for single-agent delegation and scripted multi-agent workflows. Forked from nicobailon/pi-subagents v0.71.0.",
  "type": "module",
  "license": "MIT",
  "exports": {
    ".": "./index.ts",
    "./background-work": "./src/api/background-work.ts",
    "./external-job-provider": "./src/api/external-job-provider.ts",
    "./external-runs": "./src/api/external-runs.ts",
    "./agents": "./src/api/agents.ts",
    "./delegation": "./src/api/delegation.ts",
    "./capability-ceiling": "./src/api/capability-ceiling.ts",
    "./workflow-resources": "./src/api/workflow-resources.ts",
    "./required-child-extensions": "./src/api/required-child-extensions.ts",
    "./preflight": "./src/api/preflight.ts",
    "./control-channel": "./src/api/control-channel.ts",
    "./intercom-bridge": "./src/api/intercom-bridge.ts",
    "./child-tool-plan": "./src/api/child-tool-plan.ts",
    "./shared-types": "./src/api/shared-types.ts",
    "./project-panes": "./src/api/project-panes.ts"
  },
  "bin": {
    "pi-subagents": "install.mjs"
  },
  "files": [
    "index.ts",
    "src/**/*.ts",
    "*.mjs",
    "agents/",
    "skills/**/*",
    "prompts/**/*",
    "docs/**/*",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
  "keywords": ["pi-package", "pi", "pi-coding-agent", "subagents", "ai", "agents", "cli"],
  "pi": {
    "extensions": ["./index.ts"],
    "skills": ["./skills"],
    "prompts": ["./prompts"]
  },
  "dependencies": {
    "acorn": "8.18.0",
    "jiti": "2.7.0",
    "undici": "8.10.0",
    "yaml": "2.8.3"
  },
  "peerDependencies": {
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-ai": ">=0.86.1",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-agent-core": { "optional": true },
    "@earendil-works/pi-ai": { "optional": true },
    "@earendil-works/pi-coding-agent": { "optional": true },
    "@earendil-works/pi-tui": { "optional": true },
    "typebox": { "optional": true }
  },
  "devDependencies": {
    "@earendil-works/pi-agent-core": "0.87.1",
    "@earendil-works/pi-ai": "0.87.1",
    "@earendil-works/pi-coding-agent": "0.87.1",
    "@earendil-works/pi-tui": "0.87.1",
    "@types/node": "24.13.3",
    "typebox": "^1.3.0"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/schovest/pi-package-mono.git"
  },
  "homepage": "https://github.com/schovest/pi-package-mono/tree/main/packages/pi-subagents#readme",
  "bugs": "https://github.com/schovest/pi-package-mono/issues"
}
```

- [ ] **Step 2: root tsconfig.base.json 升 ES2023**

把 `"target": "ES2022"` → `"target": "ES2023"`，`"lib": ["ES2022"]` → `"lib": ["ES2023"]`（仅这两处）。

- [ ] **Step 3: 安装并验证嵌套解析**

```bash
cd /data/mine/pi-package-mono && npm install
npm ls @earendil-works/pi-ai 2>&1 | head -20
```
Expected: root 0.80.5，`packages/pi-subagents` 下嵌套 0.87.1（其余包无嵌套）。

- [ ] **Step 4: biome 格式化本包 + 全仓 check**

```bash
cd /data/mine/pi-package-mono && npx biome check --write packages/pi-subagents && npm run check
```
Expected: 通过。若 tsc 报错：上游 CI 在 0.87.0 + ES2023 全绿，逐条 triage（只允许修类型层适配，禁止改语义），修完重跑至绿。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pi-subagents): 包 manifest 落地（嵌套 pi-*@0.87.1），root tsconfig 升 ES2023"
```

---

### Task 3: vitest projects 拆分 + pi-subagents 测试隔离 setup

**Files:**
- Modify: `vitest.config.ts`（整文件重写）
- Create: `packages/pi-subagents/test/support/vitest.setup.ts`

**Interfaces:**
- Produces: vitest project 名 `"pi-subagents"`（后续 scoped 验证用 `--project pi-subagents`）；`test/support/vitest.setup.ts`（复刻上游 isolated-temp-root 的 HOME/TMPDIR 隔离，仅对 pi-subagents 生效）。
- 说明：spec 允许「pi-ai stub 冲突时下放」；projects 拆分即该路径的落地——pi-subagents 项目不加载 root `test/setup.ts`，pi-ai mock 只作用于其余包。

- [ ] **Step 1: 重写 vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["packages/*/**/*.ts"],
      exclude: ["**/node_modules/**", "**/.pi/**", "**/dist/**", "**/*.test.ts", "**/*.d.ts"],
    },
    projects: [
      {
        test: {
          name: "core",
          include: ["packages/*/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/.pi/**", "**/dist/**", "packages/pi-subagents/**"],
          setupFiles: ["./test/setup.ts"],
          hookTimeout: 30_000,
          unstubGlobals: true,
          clearMocks: true,
          restoreMocks: true,
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: "pi-subagents",
          include: ["packages/pi-subagents/test/**/*.test.ts"],
          setupFiles: ["./packages/pi-subagents/test/support/vitest.setup.ts"],
          hookTimeout: 60_000,
          testTimeout: 60_000,
          unstubGlobals: true,
          passWithNoTests: true,
        },
      },
    ],
  },
});
```

- [ ] **Step 2: 写 vitest.setup.ts**

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll } from "vitest";

// 复刻上游 test/support/isolated-temp-root.mjs 的进程级隔离（vitest 版，仅覆盖 vitest 进程本身；
// 被 spawn 的子进程仍走原 .mjs --import 方案，那两个 loader 文件保留在盘上）。
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-test-root-"));
fs.mkdirSync(tempRoot, { recursive: true });
if (process.platform === "darwin") fs.closeSync(fs.openSync(path.join(tempRoot, ".metadata_never_index"), "a"));
process.env.PI_SUBAGENTS_TEMP_ROOT = tempRoot;
process.env.TMPDIR = tempRoot;
process.env.TMP = tempRoot;
process.env.TEMP = tempRoot;
const isolatedHome = path.join(tempRoot, "home");
fs.mkdirSync(isolatedHome, { recursive: true });
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
delete process.env.PI_CODING_AGENT_DIR;
delete process.env.XDG_CONFIG_HOME;

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});
```

- [ ] **Step 3: 验证既有包不受影响**

Run: `npx vitest run --project core`
Expected: 全绿（原 1039 用例）。`--project pi-subagents` 暂红（未转换的 node:test 文件），属预期，不修。

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts packages/pi-subagents/test/support/vitest.setup.ts && git commit -m "test: vitest 拆分 projects，pi-subagents 独立隔离 setup"
```

---

### Task 4: fork src 定制改动

**Files:**
- Delete: `packages/pi-subagents/agents/{claude-code.md,claude-code-writer.md,codex-exec.md,codex-exec-writer.md,cursor-agent.md,cursor-agent-writer.md}`
- Modify: `packages/pi-subagents/src/agents/builtin-names.ts`（整文件重写）
- Modify: `packages/pi-subagents/src/agents/agents.ts`（5 处，见下）
- Modify: grep 圈定的其余 src/docs/skills/prompts 提及处

**Interfaces:**
- Produces: `BUILTIN_AGENT_NAMES`（14 → 8 项：advisor、delegate、evidence-auditor、oracle、researcher、reviewer、scout、worker）；发现源集合去掉 `~/.agents` 与 `<root>/.agents`。Task 5 的测试依赖这些符号与行为。

- [ ] **Step 1: 删 6 个 md + 重写 builtin-names.ts**

```bash
cd /data/mine/pi-package-mono/packages/pi-subagents/agents && rm claude-code.md claude-code-writer.md codex-exec.md codex-exec-writer.md cursor-agent.md cursor-agent-writer.md && ls | wc -l
```
Expected: `7`。`src/agents/builtin-names.ts` 整文件替换为：

```ts
export const BUILTIN_AGENT_NAMES = [
	"advisor",
	"delegate",
	"evidence-auditor",
	"oracle",
	"researcher",
	"reviewer",
	"scout",
	"worker",
] as const;
```

- [ ] **Step 2: agents.ts 五处精确修改**

1. `buildAgentDiscoverySources` 与 `discoverAgentsUncached` 内各有一对：
```ts
const userDirOld = path.join(getAgentDir(), "agents");
const userDirNew = path.join(os.homedir(), ".agents");
```
→ 删除 `userDirNew` 行（两处）。

2. `buildAgentDiscoverySources` 内：
```ts
const userLoaded = [...extraUserAgentDirs(), ...userScanDirs.dirs, userDirOld, userDirNew].filter(...)
```
→ 去掉 `userDirNew`。

3. `discoverAgentsUncached` 内：
```ts
const userLoaded = scope === "project" ? [] : [...extraUserAgentDirs(), ...userScanDirs.dirs, userDirOld, userDirNew].filter(...)
```
→ 去掉 `userDirNew`。

4. `buildAgentDiscoverySources` 末尾：
```ts
const userDir = process.env.PI_CODING_AGENT_DIR ? userDirOld : fs.existsSync(userDirNew) ? userDirNew : userDirOld;
```
→ `const userDir = userDirOld;`（返回对象里 `userDirNew` 字段一并删除；若类型 `AgentDiscoverySources` 有 `userDirNew` 字段则同步删）。

5. `resolveNearestProjectAgentDirs`：
```ts
const legacyDir = path.join(projectRoot, ".agents");
const preferredDir = path.join(getProjectConfigDir(projectRoot), "agents");
const candidateDirs = [legacyDir, preferredDir];
const readDirs: string[] = [];
if (isDirectory(legacyDir)) readDirs.push(legacyDir);
if (isDirectory(preferredDir)) readDirs.push(preferredDir);
```
→
```ts
const preferredDir = path.join(getProjectConfigDir(projectRoot), "agents");
const candidateDirs = [preferredDir];
const readDirs: string[] = [];
if (isDirectory(preferredDir)) readDirs.push(preferredDir);
```

- [ ] **Step 3: 删 isLegacyAgentSkillPath 及调用点**

`agents.ts` 中 `function isLegacyAgentSkillPath(...)` 整个函数删除；两处调用（约 1942 行 `listFilesRecursive` 内与 2057 行附近）删掉 `&& !isLegacyAgentSkillPath(...)` / 对应 `if` 块（2057 行调用若为独立分支则删该分支）。

- [ ] **Step 4: grep 清场（src + 文案）**

```bash
cd /data/mine/pi-package-mono/packages/pi-subagents
grep -rn "userDirNew\|\.agents\b" src --include="*.ts"
grep -rln "claude-code\|codex-exec\|cursor-agent" src docs skills prompts agents README.md
```
处理规则（逐条人工，禁止盲替）：
- src 代码/文案里把 `~/.agents`、`<root>/.agents` 描述改为 `~/.pi/agent/agents`、`<root>/.pi/agents`（诊断信息、帮助文本、`unknownAgentDiagnosticContext` 相关目录列表等）。
- 6 个 CLI 适配器的专属配置/默认值/别名（如 settings 默认、profile 引用、`applyBuiltinOverrides` 特例）整段删除；仅文档表格行删除文案即可。
- 若 src 有按 6 个名字特判的逻辑分支（如 `builtin-names.ts` 消费侧），删分支。
Run: 重跑上面两条 grep。Expected: `userDirNew` 0 命中；`.agents` 0 命中；6 个名字 0 命中（docs 历史性提及如 CHANGELOG 不算）。

- [ ] **Step 5: 验证 + Commit**

```bash
cd /data/mine/pi-package-mono && npm run check
```
Expected: 通过（tsc 对删除字段/函数的引用残留会在此暴露，逐条修至绿）。
```bash
git add -A && git commit -m "feat(pi-subagents): fork 定制——删 CLI 适配器 builtin 与 legacy .agents 发现源"
```

---

### Task 5: fork 行为测试（vitest 直写，先于批量转换）

**Files:**
- Create: `packages/pi-subagents/test/unit/fork-customization.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `BUILTIN_AGENT_NAMES`、`discoverAgents`、目录行为。
- Produces: fork 定制三点的回归防线；后续同步上游时此文件必须保持通过。

- [ ] **Step 1: 写测试（完整内容）**

```ts
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { BUILTIN_AGENT_NAMES } from "../../src/agents/builtin-names.ts";
import { discoverAgents } from "../../src/agents/agents.ts";

const REMOVED = [
	"claude-code",
	"claude-code-writer",
	"codex-exec",
	"codex-exec-writer",
	"cursor-agent",
	"cursor-agent-writer",
] as const;

function withHome<T>(home: string, run: () => T): T {
	const prevHome = process.env.HOME;
	const prevProfile = process.env.USERPROFILE;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		return run();
	} finally {
		if (prevHome === undefined) delete process.env.HOME;
		else process.env.HOME = prevHome;
		if (prevProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = prevProfile;
	}
}

function writeAgent(dir: string, fileName: string): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, fileName), "---\nname: stray-agent\n---\nbody");
}

describe("fork: builtin 裁剪", () => {
	test("外部 CLI 适配器 builtin 已删除", () => {
		for (const name of REMOVED) {
			assert.ok(!(BUILTIN_AGENT_NAMES as readonly string[]).includes(name), `${name} 不应是 builtin`);
		}
	});

	test("agents/ 目录恰含 7 个保留 builtin", () => {
		const agentsDir = path.join(fileURLToPath(new URL("../../../agents/", import.meta.url)));
		const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md")).sort();
		assert.deepEqual(files, [
			"delegate.md",
			"evidence-auditor.md",
			"oracle.md",
			"researcher.md",
			"reviewer.md",
			"scout.md",
			"worker.md",
		]);
	});
});

describe("fork: 发现目录收敛", () => {
	test("不扫描 ~/.agents", () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "fork-home-"));
		writeAgent(path.join(home, ".agents"), "stray-user.md");
		try {
			withHome(home, () => {
				const discovered = discoverAgents(home, "user");
				assert.ok(!discovered.agents.some((a) => a.name === "stray-agent"));
				assert.ok(!discovered.directories.some((d) => d.dir === path.join(home, ".agents")));
			});
		} finally {
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	test("不扫描 <root>/.agents", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "fork-project-"));
		writeAgent(path.join(root, ".agents"), "stray-project.md");
		try {
			withHome(root, () => {
				const discovered = discoverAgents(root, "project");
				assert.ok(!discovered.agents.some((a) => a.name === "stray-agent"));
				assert.ok(!discovered.directories.some((d) => d.dir === path.join(root, ".agents")));
			});
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test("正向对照：<root>/.pi/agents 与 ~/.pi/agent/agents 仍被扫描", () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "fork-pos-"));
		const project = fs.mkdtempSync(path.join(os.tmpdir(), "fork-pos-proj-"));
		writeAgent(path.join(home, ".pi", "agent", "agents"), "in-user-dir.md");
		writeAgent(path.join(project, ".pi", "agents"), "in-project-dir.md");
		try {
			withHome(home, () => {
				const userSide = discoverAgents(project, "user");
				assert.ok(userSide.directories.some((d) => d.dir === path.join(home, ".pi", "agent", "agents")));
				const projectSide = discoverAgents(project, "project");
				assert.ok(projectSide.directories.some((d) => d.dir === path.join(project, ".pi", "agents")));
			});
		} finally {
			fs.rmSync(home, { recursive: true, force: true });
			fs.rmSync(project, { recursive: true, force: true });
		}
	});
});
```

注意：`discoverAgents` 带缓存，正向/负向用例各自用全新临时目录作 cwd/home，避免缓存串扰；若发现缓存按 `(cwd, scope)` 之外维度命中，按实际签名调整隔离方式（如清模块缓存），但不得改被测代码。

- [ ] **Step 2: 运行验证**

Run: `npx vitest run --project pi-subagents packages/pi-subagents/test/unit/fork-customization.test.ts`
Expected: 5 个用例全绿。（若 directories 报告结构字段名不同，按 `AgentDiscoveryResult.directories` 实际类型断言，不改被测代码语义。）

- [ ] **Step 3: Commit**

```bash
git add packages/pi-subagents/test/unit/fork-customization.test.ts && git commit -m "test(pi-subagents): fork 定制行为回归（builtin 裁剪 + 目录收敛）"
```

---

### Task 6: unit 测试批量转换（262 文件）

**Files:**
- Modify: `packages/pi-subagents/test/unit/*.test.ts`（262 个）
- Modify（triage 涉及）: `packages/pi-subagents/test/support/*.ts` 中 import node:test 的文件

**Interfaces:**
- Consumes: Task 3 的 `--project pi-subagents` 与隔离 setup；Task 5 的 fork 测试已在同目录共存。
- Produces: `test/unit` 全部为 vitest 语法且 scoped 全绿。

- [ ] **Step 1: 机械转换脚本（/tmp，不入仓）**

```js
// /tmp/codemod-node-test.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const plain = new Set(["describe", "it", "test", "before", "after", "beforeEach", "afterEach"]);
const manual = [];
const walk = (dir) => {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p);
		else if (e.name.endsWith(".test.ts")) {
			const src = readFileSync(p, "utf8");
			const m = src.match(/import\s*\{([^}]*)\}\s*from\s*"node:test";?/);
			if (!m) continue;
			const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
			const bad = names.filter((n) => !plain.has(n));
			if (bad.length) {
				manual.push(`${p}: ${bad.join(", ")}`);
				continue;
			}
			writeFileSync(p, src.replace(m[0], `import { ${names.join(", ")} } from "vitest";`));
		}
	}
};
walk("/data/mine/pi-package-mono/packages/pi-subagents/test/unit");
if (manual.length) console.log(`MANUAL (${manual.length}):\n${manual.join("\n")}`);
```

Run: `node /tmp/codemod-node-test.mjs`
Expected: 输出 MANUAL 清单（预期含 `mock`、`typeTestContext` 等）。

- [ ] **Step 2: 残留 triage 圈定**

```bash
cd /data/mine/pi-package-mono/packages/pi-subagents
grep -rln '"node:test"' test/unit test/support
grep -rln 'mock\.\(method\|timers\|setter\|getter\)\|\.mock\.\|t\.mock\|ctx\.mock' test/unit
grep -rln '\.test(' test/unit | xargs grep -ln 'async (t)\|(t) =>\|(t),' 2>/dev/null
grep -rn 'skip:\|todo:\|only:\|concurrency:\|plan(\|diagnostic(' test/unit --include="*.test.ts" | head -30
```

- [ ] **Step 3: 三类人工改写（逐文件，禁止盲替）**

a) node:test mock → vitest（改写范式）：
```ts
// before (node:test)
const calls = mock.method(obj, "save");
calls.mock.restore();
// after (vitest)
const calls = vi.spyOn(obj, "save");
calls.mockRestore();
```
`mock.timers.enable()`/`.reset()` → `vi.useFakeTimers()`/`vi.useRealTimers()`（放在对应 beforeEach/afterEach）。

b) subtest → 嵌套（改写范式）：
```ts
// before (node:test)
it("outer", async (t) => {
	await t.test("inner a", () => { /* … */ });
	await t.test("inner b", () => { /* … */ });
});
// after (vitest)
describe("outer", () => {
	it("inner a", () => { /* … */ });
	it("inner b", () => { /* … */ });
});
```
外层 test 的共享 arrange 代码提为 describe 内局部函数或 beforeEach。

c) import 载体特殊符号：`mock`（node:test 顶层 mock 实例）、`typeTestContext` → 按用途换成 `vi` 系 API 或删除；`test/support` 里 import node:test 的 helper 改从 vitest 导入或改为纯函数。

d) options 对象（`{ skip: … }`、`{ timeout: … }`、`{ concurrency: … }`）vitest 均支持同形第二参，保留不动；跑挂了再看。

- [ ] **Step 4: scoped 全绿**

Run: `npx vitest run --project pi-subagents packages/pi-subagents/test/unit`
Expected: 262 + 1（fork）文件全绿。失败逐个 triage：
- HOME/临时目录跨用例污染 → 确认 vitest.setup.ts 生效（PI_SUBAGENTS_TEMP_ROOT 指向 temp root）；
- 依赖 root setup 的 pi-todo/i18n 清理 → 与本包无关，应不需要；
- `discoverAgents` 缓存串扰 → 用例内换独立 tmp cwd；
- 上游断言依赖 `.agents`/6 个 builtin → 属 fork 行为差，删/改该断言为 fork 语义。

- [ ] **Step 5: Commit（可按 triage 批次多次提交）**

```bash
git add packages/pi-subagents/test && git commit -m "test(pi-subagents): unit 262 文件 node:test → vitest"
```

---

### Task 7: integration 测试转换（44 文件）

**Files:**
- Modify: `packages/pi-subagents/test/integration/*.test.ts`

**Interfaces:**
- Consumes: Task 3 setup；spawn 出去的子进程继续使用盘上 `test/support/isolated-temp-root.mjs`、`register-loader.mjs`、`native-peer-loader.mjs` 等（不删不改它们的 --import 用法）。

- [ ] **Step 1: 验证 loader 是否必需**

```bash
cd /data/mine/pi-package-mono/packages/pi-subagents
grep -rn 'from "\./.*\.js"' src --include="*.ts" | head
```
Expected: 0 命中（上游注释声称 .js 后缀，实测应为 .ts；若真有 .js 相对导入，保留 ts-loader 思路并在 spawn 子进程命令行继续挂 register-loader.mjs，vitest 进程本身不受影响）。

- [ ] **Step 2: codemod + 三类人工改写**

复制 Task 6 Step 1 的 `/tmp/codemod-node-test.mjs` 全文到 `/tmp/codemod-integration.mjs`，把其中 `walk("/data/mine/pi-package-mono/packages/pi-subagents/test/unit")` 改为 `walk("/data/mine/pi-package-mono/packages/pi-subagents/test/integration")` 后运行；然后按 Task 6 Step 3 的 a)–d) 四类改写范式逐文件人工处理。integration 特有 triage：
- 子进程 spawn 命令里 `--import .../isolated-temp-root.mjs` 保留（子进程自己的 HOME 隔离）；父（vitest）侧不重复处理；
- `PI_SUBAGENTS_TEST_LOADER` / `PI_SUBAGENTS_TEST_PARENT_PID` 状态机是子进程间协议，测试断言若依赖「父进程已置位」，改为显式在 spawn env 里注入期望值；
- 断言 fork 行为差异的用例（`.agents`、6 个 builtin）改写为 fork 语义或删除。

- [ ] **Step 3: scoped 全绿**

Run: `npx vitest run --project pi-subagents packages/pi-subagents/test/integration`
Expected: 44 文件全绿。

- [ ] **Step 4: Commit**

```bash
git add packages/pi-subagents/test && git commit -m "test(pi-subagents): integration 44 文件 node:test → vitest"
```

---

### Task 8: smoke 转换（1 文件 + 15 支撑文件）

**Files:**
- Modify: `packages/pi-subagents/test/smoke/tool-activation.test.ts`
- Keep: `test/smoke/` 其余 15 个文件原样（mjs/ts 支撑脚本，作为 spawn 目标/数据，不被 vitest 收集）

- [ ] **Step 1: 转换 tool-activation.test.ts**

同 Task 6 规则；该文件 import 真实 `@earendil-works/pi-coding-agent`（0.87.1 嵌套依赖在此接受真身，不 mock），`{ timeout: 30_000 }` 保留。

- [ ] **Step 2: scoped 全绿**

Run: `npx vitest run --project pi-subagents packages/pi-subagents/test/smoke`
Expected: 全绿。失败 triage：0.87.0（上游 CI 版本）与 0.87.1 的 API 差异逐条适配（只动类型/导入路径，不改断言语义）；真机耗时超 60s 则在该用例 options 提高 timeout。

- [ ] **Step 3: 全量收口**

Run: `npm run check && npm test`
Expected: 全部绿（core + pi-subagents 两个 project）。

- [ ] **Step 4: Commit**

```bash
git add packages/pi-subagents/test && git commit -m "test(pi-subagents): smoke 适配 vitest，测试转换收口全绿"
```

---

### Task 9: ship-manifest 校验

**Files:**
- Create: `packages/pi-subagents/ship-manifest.test.ts`

**Interfaces:**
- Consumes: `verifyShipManifest`（`@schovest/pi-test-utils`，workspace 内已有）。

- [ ] **Step 1: 写测试**

```ts
import { expect, test } from "vitest";
import { verifyShipManifest } from "@schovest/pi-test-utils";

test("ship manifest: files 字段与磁盘生产文件树双向一致", () => {
	expect(verifyShipManifest(import.meta.url).missing).toEqual([]);
});
```

- [ ] **Step 2: 运行并校准 files**

Run: `npx vitest run --project pi-subagents packages/pi-subagents/ship-manifest.test.ts`
Expected: PASS。若报 stale/missing：按输出调整 package.json `files`（预期坑：`src/**/*.ts` 未含 `src/**/*.d.ts` 时补模式；`*.mjs` 应已覆盖根 5 个脚本）。**不许**为凑校验把测试/支撑文件加进 `files`。

- [ ] **Step 3: Commit**

```bash
git add packages/pi-subagents/ship-manifest.test.ts packages/pi-subagents/package.json && git commit -m "test(pi-subagents): ship-manifest 双向校验"
```

---

### Task 10: 文档（README / CHANGELOG / 根 AGENTS.md）

**Files:**
- Modify: `packages/pi-subagents/README.md`
- Modify: `packages/pi-subagents/CHANGELOG.md`
- Modify: `AGENTS.md`（仓根）

- [ ] **Step 1: README 顶部加 fork 段（紧跟标题/横幅之后）**

```markdown
> **Fork**: `@schovest/pi-subagents` is a fork of [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) `v0.71.0`, maintained in [schovest/pi-package-mono](https://github.com/schovest/pi-package-mono). Fork changes:
>
> 1. Removed the builtin external CLI adapter agents: `claude-code`/`-writer`, `codex-exec`/`-writer`, `cursor-agent`/`-writer`.
> 2. Removed the legacy `~/.agents` and `<root>/.agents` agent discovery sources. Agent definitions load from `<root>/.pi/agents`, `~/.pi/agent/agents`, npm package providers, `PI_SUBAGENT_EXTRA_AGENT_DIRS`, settings `agentScanDirs`/`agentExcludeDirs`, and chains.
>
> Install: `pi install npm:@schovest/pi-subagents`
```

同时：README 内如有 6 个被删 agent 的表格行/段落，删除；`pi install npm:pi-subagents` 全部改为 `pi install npm:@schovest/pi-subagents`。

```bash
grep -n "claude-code\|codex-exec\|cursor-agent\|npm:pi-subagents" packages/pi-subagents/README.md
```
Expected: 0 命中（fork 段自身的来源说明除外）。

- [ ] **Step 2: CHANGELOG 追加条目（置于文件最上方）**

```markdown
## 0.1.0

Fork of nicobailon/pi-subagents v0.71.0, published as `@schovest/pi-subagents`.

- Removed builtin external CLI adapter agents: `claude-code`/`-writer`, `codex-exec`/`-writer`, `cursor-agent`/`-writer`.
- Removed legacy `~/.agents` and `<root>/.agents` agent discovery sources (and the `.agents/skills` exclusion workaround).
- Everything else unchanged: builtin `scout`/`researcher`/`evidence-auditor`/`worker`/`reviewer`/`oracle`/`delegate`, project `<root>/.pi/agents`, user `~/.pi/agent/agents`, npm package providers, `PI_SUBAGENT_EXTRA_AGENT_DIRS`, settings `agentScanDirs`/`agentExcludeDirs`, and chains.
```

- [ ] **Step 3: 根 AGENTS.md 加小节（包表加一行 `pi-subagents`，并在移植约定小节区追加）**

```markdown
`pi-subagents`（目录 `packages/pi-subagents`）迁移自 [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents)
tag v0.71.0（= npm 0.71.0）。
**移植约定**：相对导入保留 `.ts` 后缀（上游原生风格）；src/test/docs/skills/prompts 全量搬运，307 个测试适配
vitest（root vitest projects 拆分为 core / pi-subagents 两个 project，包内测试用 `test/support/vitest.setup.ts`
复刻上游 isolated-temp-root 隔离，不加载 root setup）；devDeps 嵌套 `@earendil-works/pi-*@0.87.1`
（上游 peer 要求 `pi-ai>=0.86.1`，与其余包的 0.80.5 并存，勿混升）；LICENSE 保留 Nico Bailon 版权署名。
**定制改动（同步上游时必须重放）**：
1. 删除 builtin CLI 适配器 agent：claude-code/-writer、codex-exec/-writer、cursor-agent/-writer（agents/ 与 builtin-names.ts）；
2. 删除 `~/.agents`（userDirNew）与 `<root>/.agents`（legacyDir）两个 legacy 发现源及 `isLegacyAgentSkillPath`；
3. 保留 `<root>/.pi/agents`、`~/.pi/agent/agents`、npm package 源、`PI_SUBAGENT_EXTRA_AGENT_DIRS`、
   settings `agentScanDirs`/`agentExcludeDirs`、chains。
```

- [ ] **Step 4: Commit**

```bash
git add packages/pi-subagents/README.md packages/pi-subagents/CHANGELOG.md AGENTS.md && git commit -m "docs(pi-subagents): fork 说明与移植约定"
```

---

### Task 11: 最终验收

- [ ] **Step 1: 全仓验证**

Run: `npm run check && npm test`
Expected: 全绿。

- [ ] **Step 2: spec 验收清单逐项核对**

对照 `docs/superpowers/specs/2026-09-26-pi-subagents-port-design.md`「验收清单」逐项打勾（agents/ 恰 7 个、无残留引用、check/test 绿、manifest 过、文档齐、版本 0.1.0）。

- [ ] **Step 3: 收尾提交（如有零星修正）+ 汇报**

```bash
git status --short   # 应为空或仅验收修正
git log --oneline -12
```
汇报发布前置：需在 npmjs.com 为 `@schovest/pi-subagents` 配置 Trusted Publisher（schovest / pi-package-mono / publish.yml），配置后 push main 即由 CI 发布；或本地 `npm run publish:first`。
