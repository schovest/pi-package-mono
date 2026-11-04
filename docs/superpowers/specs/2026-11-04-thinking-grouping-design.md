# pi-compact-display thinking 折叠聚合（thinkingGrouping）— 设计文档

日期：2026-11-04
状态：已批准（展开形态选 A：全部合并到标签处；实现路径、预设决定均经用户确认）

## 背景

`hideThinking: true` 目前把 assistant 消息里的 thinking 块**全部**过滤掉（index.ts 补丁
`AssistantMessageComponent.prototype.updateContent`），用户无法按需查看。

上游 `AssistantMessageComponent`（pi-coding-agent 1.4.0）的行为：

- **单条消息内**连续 thinking 块已合并为一个 run（`thinkingRunIndex`），每个 run 一个可点击的
  折叠标签（`MouseRegion` 包住斜体 `Thinking...`，点击经 `thinkingVisibilityOverrides` 切换）。
- 用户看到的**多个并列 `Thinking...`** 来自同一回合的多条 assistant 消息（thinking → 工具调用
  → thinking → 工具调用……pi 每段生成一条消息），每条消息各画各的标签。

现有 `grouping` 全局参数只聚合 lines 模式的工具卡片，不涉及 thinking。

## 目标

新增折叠聚合参数：同一回合（两条用户消息之间）所有 assistant 消息的 thinking 合并为
**一个**可点击条目；收起显示一个 `Thinking... ×N` 标签，点击展开后全部思考内容按顺序
合并渲染在标签位置（用户选定的形态 A），再点击收起。

非目标：

- 不改工具卡片 grouping（`group.ts` 既有逻辑不动）。
- 不改 LLM 上下文（`context` 事件清洗逻辑不变；本功能纯 renderer 层）。
- 不接管宿主端 thinking level / markdown transformer 机制。

## 方案（唯一合理路径，已确认）

扩展现有 `updateContent` 补丁 + 复用 `group.ts` 父子镜像扫描。否决的替代路径：

- 术后替换上游 MouseRegion handler：展开内容反正要自绘，手术无收益。
- `message_end` 层合并消息本体：污染 LLM 上下文，违反本包 renderer-only 约定。

### 行为定义

1. **过滤**：折叠模式生效时，所有 assistant 消息的 thinking 在交给 original 前过滤
   （与现 hideThinking 同一路径），上游不再画各消息自己的标签。
2. **成员发现**：复用 `group.ts` 镜像 + 回合边界扫描（`isTurnBoundary` = 用户消息）。
   领队 = 回合内第一条含 thinking 的消息；成员 = 同回合所有含 thinking 的消息，
   每成员的文本 = 其消息内全部 thinking 块文本（trim 后非空）按序收集。
3. **领队自绘**：领队过滤渲染后，按第一个 thinking 块的原插入位（前导 Spacer +
   之前可见 text 块数计算 index）插入自绘组件：
   - 收起：斜体 `Thinking... ×N`（`thinkingText` 前景色；N≥2 才显示 `×N` 计数），
     `MouseRegion` 左键点击切换整组展开/收起；
   - 展开：单块 `Markdown`（`getMarkdownTheme()` + `theme.fg("thinkingText")` +
     italic），全部思考以 `\n\n` 连接；与上游 thinking 视觉一致
     （上游 `createMarkdownTransform` 默认 transformers 为空数组 = 恒等变换，
     且包 `exports` 禁止深导入，故不用 transform，无视觉差异）。
   - 后随可见 text 时在组件后补 Spacer，空行节奏与上游一致。
4. **状态与重绘**：展开状态存模块级 `WeakMap`（按领队组件）；点击时经镜像找成员，
   逐个 `updateContent(lastMessage)` 重渲染（与上游点击重绘路径一致）。
   theme 从 `registerToolRenderer` 回调捕获（模块级缓存，每帧回调都传 theme，捕获可靠）；
   缺失时降级为无色渲染。
5. **插入点顺序保证**：领队消息形如 `[thinking, text]` 时组件必须出现在 text 之前
   （appended 会落到 text 之后，因此按内容索引计算插入点，不用 push）。

### 配置

新增全局参数，与 `grouping` / `hideThinking` 并列：

```json
{
  "hideThinking": true,
  "thinkingGrouping": true
}
```

- 仅 `hideThinking: true` 时生效（hideThinking 的增强子模式；单独设置无效）。
- `config.ts` proxy 的保留键列表登记 `thinkingGrouping`（防被当作工具名回退）。

### 预设决定（次要，已确认不调整）

- 会话重载/重开后默认收起（WeakMap 随组件重建清空，与上游 per-run 默认一致）。
- 宿主端 thinking 显示 toggle（`setHideThinkingBlock`）在折叠模式下不产生效果
  （thinking 已被接管）——与现 hideThinking 全量隐藏的行为一致。
- 扩展注册的 markdown transformer 不作用于展开内容（默认空数组，无差异）。
- 流式中：当前消息的 thinking 同样并入组（收起标签计数实时增长），无闪烁。

## 改动点

- `src/config.ts`：`Config` 增 `thinkingGrouping?: boolean`；proxy 保留键登记。
- `src/thinkingGroup.ts`（新增）：镜像扫描、领队/成员判定、展开状态 WeakMap、
  自绘组件（收起标签 / 展开 Markdown）、theme 捕获接口。
- `src/index.ts`：现 `updateContent` 补丁扩展为三分支（hideThinking 纯隐藏 /
  thinkingGrouping 折叠聚合 / 原样透传）；接 theme 捕获。
- `README.md`：配置示例与行为说明（`hideThinking` 章节内）。

## 测试

新增 `tests/thinkingGroup.test.ts`（沿用 group.test.ts 的镜像 mock 模式）：

- 回合扫描：跨多条 assistant 消息正确收集成员与文本；用户消息切回回合边界。
- 领队判定：回合内第一条含 thinking 的消息；无 thinking 回合无插入。
- 收起渲染：单 thinking 不带计数；N≥2 带 `×N`。
- 点击切换：展开渲染合并 Markdown（`\n\n` 连接）；再点击收起；成员重渲染调用。
- 过滤：折叠模式下成员消息各自的 thinking 不渲染；领队 text 内容位置正确
  （thinking 在 text 前的消息，组件插入 text 之前）。
- 配置：proxy 对 `thinkingGrouping` 保留键返回 undefined；未设 hideThinking 时不生效。
- 回归：hideThinking 纯隐藏路径与现有 `hideThinking.test.ts` 全部保持通过。

验证命令：`npx vitest run packages/pi-compact-display` 全绿。

## 版本

`pi-compact-display` minor 升级（`npm run version:minor -- pi-compact-display`），
发布走 CI 通道。
