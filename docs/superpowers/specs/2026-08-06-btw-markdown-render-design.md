# pi-btw 命令面板新增 markdown 渲染 — 设计文档

日期：2026-08-06
状态：已批准（方案 A，用户确认：仅答案正文渲染、用主聊天同款主题）

## 背景

`/btw` 侧问命令的答案目前以纯文本渲染在底部面板：

- `btw-ui.ts` 的 `renderAnswer()` 对答案正文调用 `wrapBodyLines()`（`wrapTextWithAnsi` 纯文本换行），
  不识别任何 markdown 结构——标题、粗体、代码块、列表在终端里全部退化为普通文本。
- 上游 rpiv-mono 同样未实现，本功能为 pi-btw 仓库新增。

## 目标

答案正文按 markdown 渲染，视觉与主聊天（assistant-message）完全一致。

非目标：

- 不渲染 banner / 历史 / 回显的问题行（保持单行纯文本截断）。
- 不渲染错误信息（保持纯文本 error 色）。
- 不改布局（banner/history/echo/footer 的排版逻辑不变）。
- 不改 btw.ts 主流程（setAnswer 一次性写入语义不变）。

## 方案（已批准：方案 A — controller 内嵌 Markdown 组件实例）

复用 pi 主程序同款渲染管线：

- **组件**：`@earendil-works/pi-tui` 的 `Markdown` 组件（marked 18 驱动，text+width 键控缓存，
  `setText()` 自动失效缓存）。
- **主题**：`@earendil-works/pi-coding-agent` 的 `getMarkdownTheme()` —— 主聊天
  assistant-message 用的同一工厂函数，内置全部 md* 主题色 + `highlightCode`（有语言标注的
  代码块走 cli-highlight 语法高亮，无标注的用 mdCodeBlock 主题色）。

### 改动点（btw-ui.ts，约 6 行）

1. 构造器：新增字段

   ```ts
   private readonly markdown = new Markdown("", 0, 0, getMarkdownTheme());
   ```

   `paddingX = 0`：缩进由面板自己的 `ANSWER_PAD`（4 列）承担，与现有布局一致。

2. `setAnswer(text)`：追加 `this.markdown.setText(text)`。

3. `renderAnswer()` 的 answer 分支：`wrapBodyLines(this.answer, bodyWidth)` 替换为
   `this.markdown.render(bodyWidth)`，输出行照旧统一加 `ANSWER_PAD` 前缀。

pending / error 分支不动（仍用 `wrapBodyLines`）。

## 测试

`btw-ui.test.ts` 更新：

- 现有断言按 Markdown 组件实际输出调整（纯文本语义不变，输出行数/样式以组件实际行为为准）。
- 新增 markdown 渲染用例：标题、粗体、行内代码、代码块（含/不含语言标注）、链接。
- 现有布局用例（banner/echo/footer、裁剪、滚动、清除历史）保持通过。

验证命令：`npx vitest run packages/pi-btw` 全绿。

## 文档

`docs/architecture.md` 渲染描述补充一句：答案正文按 markdown 渲染（复用主聊天主题）。

## 版本

`pi-btw` 0.1.3 → 0.1.4（`npm run version:patch -- pi-btw`）。
