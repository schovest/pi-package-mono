# thinkingGrouping 展开内容样式区分 — 短设计文档

日期：2026-11-04
状态：已批准（引用块左边框；根因修正：样式改为单例绑定优先，捕获降级，不再依赖事件捕获）

## 根因（2026-11-04 用户反馈"展开内容与普通消息没有任何区别"）

原实现所有样式（标签/内容颜色与斜体）依赖 message_start 捕获的 theme；捕获在用户运行时
（fork/旧版 pi 无 message_start 派发等场景）静默失败 → 标签纯文本、展开内容只剩斜体
（多数终端不渲染）→ 与正文完全无区分。stock 1.4.0 捕获可用（已核实 createExtensionUIContext
带 get theme()），但不能依赖它。

## 意图与 why

thinkingGrouping 展开后的思考内容当前 = thinkingText 灰 + 斜体（上游同款）。dark 主题下
`thinkingText = gray` 与正文（终端默认色）区分度弱，且斜体在部分终端不渲染——展开块读起来
像普通正文。需要明确的视觉区分。

## 方案（用户已选定：引用块左边框 + 健壮化）

复用上游 markdown blockquote 的视觉语言（`pi-tui` markdown.js blockquote 分支），并改为**单例绑定优先**：

- **边框（无条件着色）**：每行前缀 `"│ "`（U+2502 + 空格，2 列），`getMarkdownTheme().quoteBorder(...)`
  （单例绑定，无需捕获；异常降级无色 `"│ "`）。
- **内容/标签颜色**：capturedTheme 的 `thinkingText`（上游 parity）为主，缺失时回退
  `getMarkdownTheme().quote`（mdQuote 灰，单例绑定）——**永不退化纯文本**；斜体用
  `getMarkdownTheme().italic`（单例绑定）。
- **渲染**：`inner.render(Math.max(1, width - 2))` 后逐行加前缀（逐帧应用，theme 切换即时生效）。
- **范围**：仅展开内容 + 收起标签健壮化；上游自身 thinking 渲染（grouping off）不动。空行
  前缀跟随上游 blockquote 行为（全部行加前缀）。

否决的替代：整块缩进 + dim（可能过暗难读）；边框 + dim 叠加（可读性风险）；背景色块
（主题无专用 thinking 背景 token，借用语义不符）。

## 改动点

- `src/thinkingGroup.ts`：`ThinkingGroupWidget` 展开分支 render 输出加边框前缀（~10 行）。
- `tests/thinkingGroup.test.ts`：新增/适配断言（展开行含 `│ ` 前缀；既有 toContain 断言兼容）。
- `README.md`：`Merged Thinking (thinkingGrouping)` 小节补样式描述（引用块边框区分）。
- `README_ja.md`：同步 thinkingGrouping 整节（还清上轮文档债）。

## 测试

- 展开渲染每行含 `│ ` 前缀；theme 未捕获时内容仍带 mdQuote 色（不再退化纯文本）。
- 既有展开/收起/点击用例保持绿（文本断言 toContain 不受前缀影响）。
- 验证：`npx vitest run packages/pi-compact-display` + `npm run check`。

## 版本

patch 升级（0.2.0 → 0.2.1），发布走 CI 通道。
