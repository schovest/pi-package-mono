# pi-compact-display thinking 折叠聚合（thinkingGrouping）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一回合多个 assistant 消息的 thinking 合并为一个可点击条目——收起显示 `Thinking... ×N`，点击展开后全部思考合并渲染在标签位置。

**Architecture:** 扩展现有 `AssistantMessageComponent.prototype.updateContent` 补丁为三分支；复用 `group.ts` 父子镜像做回合扫描；领队组件插入自绘动态 widget（每帧重算组员与计数），展开状态存模块级 WeakMap。

**Tech Stack:** TypeScript strict / vitest 4.x（根 runner）/ @earendil-works/pi-tui 1.4.0（Text、Markdown、MouseRegion、Spacer）/ @earendil-works/pi-coding-agent 1.4.0（AssistantMessageComponent、getMarkdownTheme）。

**Spec:** `docs/superpowers/specs/2026-11-04-thinking-grouping-design.md`

## Global Constraints

- TS strict、2 空格、120 列；biome 负责格式（根 `biome.json`，勿升 1.9.4）；本包导入用 `.ts` 后缀。
- 依赖零变动：devDeps 保持 `@earendil-works/pi-{coding-agent,tui}@1.4.0` 精确嵌套，禁止新增运行时依赖。
- renderer-only：不触碰 LLM 上下文（`context` 事件与 `cleanContextMessages` 不改）。
- `group.ts` 既有工具卡片 grouping 逻辑不改；只新增一个导出函数。
- 组件判定一律走 `componentUtils.ts` 的构造器名判定（loader 无关），禁止 instanceof。
- 全程验证命令：`npx vitest run packages/pi-compact-display`；收尾 `npm run check`（biome + tsc）。

## Review Focus

1. **同消息多 thinking 块 + 跨消息混合**：计数 N 必须包含领队自己消息内的多个 run（与跨消息 run 求和）；展开文本同样包含领队自身内容 → Task 2/3 测试钉死。
2. **领队消息 text 在 thinking 之前**（如 `[text, thinking, text]`）：widget 必须插在第一个 text 之后、第二个 text 之前，不得打乱顺序 → Task 3 插入索引测试钉死。
3. **主题未捕获**（会话首条消息、theme 事件未到 / headless）：标签无色但不得崩溃，theme 到位后下一帧自动带样式 → Task 3/4 测试钉死。
4. **空/流式 thinking**：`thinking.trim()` 为空的块不计数不渲染，流式增长时计数逐帧更新 → Task 2/3 测试钉死。
5. **回合边界**：新回合（用户消息）后旧领队仍可独立展开（组员限定旧回合），新回合产生新领队 → Task 2 测试钉死。

---

### Task 1: config 新增 `thinkingGrouping` 全局参数

**Files:**
- Modify: `packages/pi-compact-display/src/config.ts`（`Config` 接口 ~L24 后、proxy 保留键 ~L51）
- Test: `packages/pi-compact-display/tests/config.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `Config.thinkingGrouping?: boolean`（后续任务经 `isActive(config)` 消费）

- [ ] **Step 1: 写失败测试** — 在 `tests/config.test.ts` 的 hideThinking 用例组后追加 3 个用例（与现有 `grouping`/`hideThinking` 用例同构）：

```ts
it('should support the global "thinkingGrouping" flag', () => {
  // loadConfig({ thinkingGrouping: true, bash: { mode: "default" } })
  expect(config.thinkingGrouping).toBe(true);
});
it('should return undefined for "thinkingGrouping" if not specified, even if "default" is specified', () => {
  // loadConfig({ default: { mode: "lines" } }) → config.thinkingGrouping === undefined
});
it('should return false for "thinkingGrouping" when explicitly set to false (no fallback to "default")', () => {
  // loadConfig({ thinkingGrouping: false, default: { mode: "lines" } }) → config.thinkingGrouping === false
});
```

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run packages/pi-compact-display/tests/config.test.ts`，预期新用例 FAIL（proxy 把 `thinkingGrouping` 当工具名回退到 `default`）。

- [ ] **Step 3: 实现** — `config.ts`：`Config` 接口在 `hideThinking?: boolean` 后加 `thinkingGrouping?: boolean`（注释风格与现有一致：グローバル設定、hideThinking:true 时把整回合 thinking 折叠聚合为一个可点击条目）；proxy `get` 的保留键判断追加 `|| prop === "thinkingGrouping"`。

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令，预期 PASS 且既有用例全绿。

- [ ] **Step 5: 提交** — `git add packages/pi-compact-display/src/config.ts packages/pi-compact-display/tests/config.test.ts && git commit -m "feat(pi-compact-display): add thinkingGrouping global config flag"`

### Task 2: 回合扫描核心（group.ts 镜像访问器 + thinkingGroup.ts）

**Files:**
- Modify: `packages/pi-compact-display/src/group.ts`（末尾追加一个导出函数）
- Create: `packages/pi-compact-display/src/thinkingGroup.ts`
- Test: `packages/pi-compact-display/tests/thinkingGroup.test.ts`（新建）

**Interfaces:**
- Consumes: `group.ts` 私有 `parentMap`/`childrenMap`（新增访问器）、`componentUtils.ts` 的 `isUserMessage`/`isAssistantMessage`
- Produces（后续任务依赖的精确签名，全部从 `./thinkingGroup.ts` 导出）:

```ts
export interface ThinkingTurnMember { comp: any; texts: string[]; }
export interface ThinkingTurnGroup { leader: any; members: ThinkingTurnMember[]; totalRuns: number; }
export function isActive(config: Config): boolean;
// hideThinking === true && thinkingGrouping === true
export function extractThinkingTexts(message: any): string[];
// message.content 中 type === "thinking" 的块，取 c.thinking.trim() 非空者，按序返回
export function readOriginalMessage(comp: any): any;
// comp.__piCompactOriginalMessage ?? comp.lastMessage
export function resolveTurnGroup(owner: object): ThinkingTurnGroup | undefined;
// 经 getContainerChildren(owner) 取兄弟数组；无镜像 → undefined。
// 以 owner 位置为锚：向前/向后扫到 isUserMessage 边界（不含），收集所有
// isAssistantMessage(c) 且 extractThinkingTexts(readOriginalMessage(c)).length > 0 的成员；
// leader = members[0]；totalRuns = 各成员 texts.length 求和。
```

group.ts 追加（复用现有私有镜像，不改任何既有函数）:

```ts
export function getContainerChildren(owner: object): any[] | undefined {
  const container = parentMap.get(owner);
  return container ? childrenMap.get(container) : undefined;
}
```

- [ ] **Step 1: 写失败测试** — 新建 `tests/thinkingGroup.test.ts`，仿照 `group.test.ts` 的模式（`vi.mock("fs")`、真 `Container` + `trackChild`、构造器名假组件）：

```ts
// 假 assistant 组件：readOriginalMessage 读取的字段
function makeAssistant(content: any[], extra: any = {}) {
  return {
    constructor: { name: "AssistantMessageComponent" },
    lastMessage: { role: "assistant", content, stopReason: "stop" },
    ...extra,
  };
}
const userMsg = { constructor: { name: "UserMessageComponent" } };

// 用例（各一个 it）：
// 1. isActive: { hideThinking: true, thinkingGrouping: true } → true；
//    缺 hideThinking / 缺 thinkingGrouping / false 任一 → false
// 2. extractThinkingTexts: 跳过空白 thinking 与非 thinking 块，按序提取
// 3. resolveTurnGroup 跨消息聚合：userMsg | a1(thinking T1) | tool | a2(thinking T2, T3) | a3(纯 text)
//    → resolveTurnGroup(a2) = { leader: a1, members: [a1, a2], totalRuns: 3 }（Review Focus #1：
//    a2 消息内两个 run 都计数）
// 4. 回合边界：userMsg | a1(T1) | userMsg | a2(T2) → resolveTurnGroup(a2).members = [a2]，
//    leader = a2，不含上一回合的 a1（Review Focus #5）
// 5. owner 无镜像（未 trackChild）→ undefined
// 6. 空白 thinking 不入组：a1(thinking "   ") | a2(T2) → members = [a2]（Review Focus #4）
```

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run packages/pi-compact-display/tests/thinkingGroup.test.ts`，预期 FAIL（模块不存在）。

- [ ] **Step 3: 实现** — 按上方 Interfaces 逐字实现；`group.ts` 追加 `getContainerChildren`。`thinkingGroup.ts` 头部导入：`isAssistantMessage, isUserMessage`（`./componentUtils.ts`）、`type Config`（`./config.ts`）、`getContainerChildren`（`./group.ts`）。

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令，PASS；再跑 `npx vitest run packages/pi-compact-display/tests/group.test.ts` 确认 group 既有用例无回归。

- [ ] **Step 5: 提交** — `git add packages/pi-compact-display/src/group.ts packages/pi-compact-display/src/thinkingGroup.ts packages/pi-compact-display/tests/thinkingGroup.test.ts && git commit -m "feat(pi-compact-display): turn-scoped thinking group scan"`

### Task 3: 自绘 widget 与插入逻辑

**Files:**
- Modify: `packages/pi-compact-display/src/thinkingGroup.ts`（追加导出）
- Test: `packages/pi-compact-display/tests/thinkingGroup.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 2 全部导出；`pi-tui` 的 `Markdown`、`MouseRegion`、`Spacer`、`Text`；`pi-coding-agent` 的 `getMarkdownTheme`
- Produces:

```ts
export function setCapturedTheme(theme: unknown): void;   // 模块级缓存，渲染时使用
export function toggleThinkingGroup(comp: any, group: ThinkingTurnGroup): void;
// 翻转 WeakMap<object, boolean> 中 comp 的展开态，然后对 group.members 逐个
// m.comp.updateContent?.(m.comp.lastMessage)（与上游点击重绘路径一致）
export function appendGroupWidget(comp: any): void;
// no-op 条件：readOriginalMessage(comp) 无 thinking 文本；resolveTurnGroup 无组；
// group.leader !== comp。否则计算插入索引并 splice 进 comp.contentContainer.children：
//   firstThinking = content.findIndex(c => c.type === "thinking")
//   textBefore    = 前 slice 中 text 且 text.trim() 非空的块数
//   index         = (整条消息存在非空 text ? 1 : 0) + textBefore   // 1 = 上游前导 Spacer
//   hasTextAfter  = firstThinking 之后存在非空 text 块
//   block = [ index === 0 时 Spacer(1)] + [MouseRegion(widget, handler)] + [hasTextAfter 时 Spacer(1)]
//   handler = () => { const g = resolveTurnGroup(comp); if (g) toggleThinkingGroup(comp, g); return { handled: true }; }
//   children.splice(Math.min(index, children.length), 0, ...block)
// class ThinkingGroupWidget（不导出）{ render(width): string[]; invalidate(): void; }
// render：resolveTurnGroup(comp) 每帧重算；组散/非 leader → []。
//   收起：base = comp.hiddenThinkingLabel（非 string 时 "Thinking..."）；
//         label = totalRuns >= 2 ? `${base} ×${totalRuns}` : base；
//         Text(theme ? theme.italic(theme.fg("thinkingText", label)) : label, comp.outputPad ?? 0, 0)
//   展开：members.flatMap(m => m.texts).join("\n\n")；
//         Markdown(joined, comp.outputPad ?? 0, 0, comp.markdownTheme ?? getMarkdownTheme(),
//                  { italic: true, ...(theme?.fg ? { color: (t) => theme.fg("thinkingText", t) } : {}) })
//   theme 函数调用前做 typeof === "function" 防御（同 renderUtils 既有风格）；
//   内件按 key（"c:"+label / "e:"+joined）变化时重建并缓存，未变化直接返回上次内件 render(width)。
```

- [ ] **Step 1: 写失败测试** — 在 `tests/thinkingGroup.test.ts` 追加 describe，假组件带上 widget 读取的字段（`outputPad: 1`、`hiddenThinkingLabel: "Thinking..."`、`contentContainer: new Container()`、`updateContent: vi.fn()`）：

```ts
// 用例（Review Focus #2 先行）：
// 1. 插入索引 — original [text "a", thinking T, text "b"]（children 初始 = [Spacer, Text("a-md")]）：
//    appendGroupWidget(comp) 后 children = [Spacer, Text("a-md"), MouseRegion, Spacer]
// 2. thinking-only 消息 — original [thinking T]（children 初始 = []）：
//    children = [Spacer, MouseRegion]（前导 Spacer 补齐）
// 3. [thinking, text] — children 初始 = [Spacer, Markdown]：children = [Spacer, MouseRegion, Spacer, Markdown]
// 4. 非领队 no-op — 组内第二成员调用 appendGroupWidget → children 不变
// 5. 收起标签计数 — 营造 totalRuns=3（经 resolveTurnGroup 的镜像），
//    render widget：label 含 "Thinking... ×3"；totalRuns=1 时不含 "×"；
//    setCapturedTheme({ fg: (n, s) => `<${n}>${s}</${n}>`, italic: (s) => `~${s}~` }) 后标签 = ~<thinkingText>Thinking... ×3</thinkingText>~
// 6. 展开 — toggleThinkingGroup(comp, group) 后 widget.render(width) 输出行 join 后含
//    各 texts（"\n\n" 连接）；再 toggle 回收起，标签重现
// 7. toggle 成员重绘 — toggleThinkingGroup 后 group.members 各 comp.updateContent 被调用一次
// 8. theme 未捕获（Review Focus #3）— 不调 setCapturedTheme，收起/展开 render 不抛错、
//    标签为纯文本 "Thinking..."（无 ANSI 包装）
// 9. 流式空 thinking（Review Focus #4）— comp original [thinking "  "] 无其他成员 →
//    appendGroupWidget no-op
```

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run packages/pi-compact-display/tests/thinkingGroup.test.ts`，预期新增用例 FAIL。

- [ ] **Step 3: 实现** — 按上方 Produces 契约实现（widget 类、WeakMap、插入逻辑；`isExpandedState` 为模块私有 helper）。

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令，全文件 PASS。

- [ ] **Step 5: 提交** — `git add packages/pi-compact-display/src/thinkingGroup.ts packages/pi-compact-display/tests/thinkingGroup.test.ts && git commit -m "feat(pi-compact-display): collapsible merged-thinking widget with insertion logic"`

### Task 4: index.ts 补丁接线 + theme 捕获

**Files:**
- Modify: `packages/pi-compact-display/src/index.ts`（现 updateContent 补丁 L41-58 重写为三分支；`pi.on("message_start", ...)` 新增）
- Test: `packages/pi-compact-display/tests/hideThinking.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 `isActive`（经 config）、Task 2/3 `setCapturedTheme`/`appendGroupWidget`；现有 `loadExtension` mock 模式
- Produces: 完整三分支行为（对外无新导出）

index.ts 补丁重写为（保持原注释块，追加三分支说明）:

```ts
AssistantMessageComponent.prototype.updateContent = function (message: any) {
  if (isActive(config)) {
    const content = Array.isArray(message?.content) ? message.content : [];
    const hasThinking = content.some((c: any) => c.type === "thinking");
    if (hasThinking) (this as any).__piCompactOriginalMessage = message;
    const target = hasThinking
      ? { ...message, content: content.filter((c: any) => c.type !== "thinking") }
      : message;
    const result = originalUpdateContent.call(this, target);
    if (hasThinking) appendGroupWidget(this);
    return result;
  }
  if (config.hideThinking) {
    const filtered = { ...message, content: message.content.filter((c: any) => c.type !== "thinking") };
    return originalUpdateContent.call(this, filtered);
  }
  return originalUpdateContent.call(this, message);
};
pi.on("message_start", async (_event, ctx) => {
  const theme = (ctx as any)?.ui?.theme;
  if (theme) setCapturedTheme(theme);
});
```

- [ ] **Step 1: 写失败测试** — `tests/hideThinking.test.ts` 追加 describe `thinkingGrouping — updateContent wiring`（复用 `loadExtension`；afterEach 里额外清 `thinkingGroup` 展开态不必要——WeakMap 按组件隔离；需用真 `Container` 作为聊天容器承接镜像：`loadExtension` 后 `container.addChild(comp)` 走已打补丁的 addChild 自动 trackChild）：

```ts
// 用例：
// 1. lastMessage 过滤 — loadExtension({ hideThinking: true, thinkingGrouping: true })，
//    构造带 thinking 的消息 → lastMessage.content 不含 thinking（与纯 hideThinking 一致）
// 2. 领队插入 — 同配置，comp1=[thinking T1]（leader）经 container.addChild 后：
//    comp1.contentContainer.children 含 MouseRegion（widget 已插入）
// 3. 成员隐藏 — comp2=[thinking T2, text "hi"] 加入同容器（同回合）：
//    comp2.contentContainer.children 无 MouseRegion，text 正常渲染（children 含 1 个 Markdown）
// 4. 领队 text 顺序 — comp=[thinking T, text "hi"] 单独成回合：
//    children = [Spacer, MouseRegion, Spacer, Markdown]（MouseRegion 在 Markdown 前）
// 5. 不生效组合 — loadExtension({ thinkingGrouping: true })（无 hideThinking）→
//    thinking 保留在 lastMessage，children 无 MouseRegion；
//    loadExtension({ hideThinking: true })（无 thinkingGrouping）→ 现有纯隐藏行为不变
// 6. 宿主标签定制（Review Focus 之外补强）— comp.hiddenThinkingLabel = "思考中…" 时收起标签以它为 base
// 7. message_start theme 捕获 — loadExtension 后取 pi.on 的 "message_start" handler
//    （mockPi.on 记录调用），以 { ui: { theme: stubTheme } } 调用后，
//    新建领队组件收起标签带 stubTheme 样式
```

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run packages/pi-compact-display/tests/hideThinking.test.ts`，预期新 describe FAIL（现补丁无三分支/无 message_start）。

- [ ] **Step 3: 实现** — 按上方代码重写补丁（保留原 `// ── Hide thinking blocks (issue #2) ──` 注释块并续写折叠聚合说明）；文件头部导入 `isActive, appendGroupWidget, setCapturedTheme`（`./thinkingGroup.ts`）；在 tracker 定义后追加 `pi.on("message_start", ...)`。

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令全绿；`npx vitest run packages/pi-compact-display` 全包回归（含既有 4 个 hideThinking 用例与 integration/groupIntegration）。

- [ ] **Step 5: 提交** — `git add packages/pi-compact-display/src/index.ts packages/pi-compact-display/tests/hideThinking.test.ts && git commit -m "feat(pi-compact-display): wire thinkingGrouping into updateContent patch"`

### Task 5: README + 版本升级 + 全量验证

**Files:**
- Modify: `packages/pi-compact-display/README.md`（L16-17 特性清单、L107-108 配置示例、L214 `hideThinking` 章节内）
- Modify: `packages/pi-compact-display/package.json`（version 0.1.0 → 经脚本升级）

**Interfaces:**
- Consumes: 全部前序任务的最终行为
- Produces: 发布就绪的包版本

- [ ] **Step 1: 更新 README** — 三处：特性清单追加一条（Merged Thinking Indicator：`thinkingGrouping` 将整回合多个 `Thinking...` 合并为一个可点击条目，点击展开合并内容）；全局配置示例 JSON 追加 `"thinkingGrouping": true`；`hideThinking` 章节内追加 `thinkingGrouping` 子节（字段表一行 + 行为说明：仅在 `hideThinking: true` 时生效、收起 `Thinking... ×N`、点击展开/收起、会话重载默认收起）。
- [ ] **Step 2: 升版本** — `npm run version:minor -- pi-compact-display`（0.1.0 → 0.2.0；脚本自动同步 lockfile）。
- [ ] **Step 3: 全量验证** — `npx vitest run packages/pi-compact-display` 全绿；`npm run check`（biome + 根 tsc）零错误。
- [ ] **Step 4: 提交** — `git add packages/pi-compact-display/README.md packages/pi-compact-display/package.json package-lock.json && git commit -m "docs(pi-compact-display): document thinkingGrouping; bump to 0.2.0"`
