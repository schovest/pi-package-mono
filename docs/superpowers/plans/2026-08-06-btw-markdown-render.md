# pi-btw 命令面板 Markdown 渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/btw` 面板的答案正文按 markdown 渲染，视觉与主聊天（assistant-message）完全一致。

**Architecture:** `BtwOverlayController` 内嵌一个 pi-tui `Markdown` 组件实例（`paddingX=0`，缩进仍由面板自己的 `ANSWER_PAD` 承担）。`setAnswer()` 时 `setText()`，`renderAnswer()` 的 answer 分支从 `wrapBodyLines()` 换成 `markdown.render(bodyWidth)` + 原有缩进。主题用 `getMarkdownTheme()`（主聊天同款工厂，内置全部 md\* 主题色与 cli-highlight 语法高亮），通过构造器可选参数注入以便测试。

**Tech Stack:** TypeScript strict、pi-tui 0.80.5（`Markdown` 组件，marked 18 驱动，text+width 键控缓存）、pi-coding-agent 0.80.5（`getMarkdownTheme()`）、Vitest 4。

## Global Constraints

- 移植包相对导入保留上游 `.js` 后缀（`./btw-messages.js`），不破坏。
- Biome 负责格式与 lint（根 `biome.json`，1.9.4）；120 字符行宽、2 空格缩进。
- 修改移植包代码必须保持测试全绿：`npx vitest run packages/pi-btw`。
- 版本升级用 `npm run version:patch -- pi-btw`（只升 pi-btw，bump-version.mjs 会同步 workspace 内部依赖与 lockfile）。
- 不在本任务内触碰的：banner/history/echo/footer 布局、btw.ts 主流程、error/pending 渲染分支。

---

### Task 1: btw-ui.ts 接入 Markdown 渲染 + 测试 + 文档

**Files:**

- Modify: `packages/pi-btw/btw-ui.ts`
- Modify: `packages/pi-btw/btw-ui.test.ts`
- Modify: `packages/pi-btw/docs/architecture.md`

**Interfaces:**

- Consumes: pi-tui `Markdown`（`new Markdown(text, paddingX, paddingY, theme)`，`setText(text)`，`render(width): string[]`；空/空白文本返回 `[]`）、`MarkdownTheme` 类型；pi-coding-agent `getMarkdownTheme()`。
- Produces: `BtwOverlayController` 构造器追加第 8 个可选参数 `markdownTheme: MarkdownTheme = getMarkdownTheme()`；`setAnswer(text)` 内部同步 `markdown.setText(text)`。

- [ ] **Step 1: 更新测试文件 — 加 identity MarkdownTheme 与构造器传参**

  测试环境未调用 `initTheme()`，`getMarkdownTheme()` 会抛 "Theme not initialized"，因此测试必须注入 identity 主题。在 `btw-ui.test.ts` 中：

  ```ts
  import type { Theme } from "@earendil-works/pi-coding-agent";
  import { type MarkdownTheme, type TUI, visibleWidth } from "@earendil-works/pi-tui";
  ```

  （即给 pi-tui 的 import 增加 `type MarkdownTheme`）

  在 `identityTheme` 常量后新增：

  ```ts
  // 测试环境没有 initTheme()，getMarkdownTheme() 会抛错；identity 主题让断言只看布局。
  const identityMarkdownTheme: MarkdownTheme = {
    heading: (s) => s,
    link: (s) => s,
    linkUrl: (s) => s,
    code: (s) => s,
    codeBlock: (s) => s,
    codeBlockBorder: (s) => s,
    quote: (s) => s,
    quoteBorder: (s) => s,
    hr: (s) => s,
    listBullet: (s) => s,
    bold: (s) => s,
    italic: (s) => s,
    strikethrough: (s) => s,
    underline: (s) => s,
    highlightCode: (code) => code.split("\n"),
  };
  ```

  `makeController` 的 `new BtwOverlayController(...)` 调用追加第 8 个参数：

  ```ts
  const ctl = new BtwOverlayController(
    opts.question ?? "what?",
    opts.history ?? [],
    identityTheme,
    tui,
    done,
    controller,
    onClearHistory,
    identityMarkdownTheme, // 新增：注入 identity markdown 主题
  );
  ```

- [ ] **Step 2: 新增 markdown 渲染测试用例（此时应失败）**

  在 `setAnswer` describe 块后新增 describe：

  ```ts
  describe("BtwOverlayController — markdown answer rendering", () => {
    it("renders headings with the '#' prefix preserved", () => {
      const { ctl } = makeController();
      ctl.setAnswer("# Title");
      expect(ctl.render(80).join("\n")).toContain("# Title");
    });

    it("renders bold inline text", () => {
      const { ctl } = makeController();
      ctl.setAnswer("**bold** text");
      expect(ctl.render(80).join("\n")).toContain("bold");
    });

    it("renders inline code", () => {
      const { ctl } = makeController();
      ctl.setAnswer("run `npm i` now");
      expect(ctl.render(80).join("\n")).toContain("npm i");
    });

    it("renders fenced code blocks with language fence and body", () => {
      const { ctl } = makeController();
      ctl.setAnswer("```ts\nconst x = 1;\n```");
      const out = ctl.render(80).join("\n");
      expect(out).toContain("```ts");
      expect(out).toContain("const x = 1;");
    });

    it("renders links with their visible text", () => {
      const { ctl } = makeController();
      ctl.setAnswer("see [pi](https://pi.ai)");
      expect(ctl.render(80).join("\n")).toContain("pi");
    });
  });
  ```

  断言只依赖可见文本（heading 保留 `#` 前缀、代码块 fence 原样输出），不依赖 ANSI 装饰细节，identity 主题下稳定。

- [ ] **Step 3: 运行测试验证新用例失败**

  Run: `npx vitest run packages/pi-btw/btw-ui.test.ts`
  Expected: 失败——实现仍是纯文本 wrap，markdown 语法字符（`#`、`**`、`` ` ``）原样输出；heading 用例中输出是 `# Title` 的纯文本……注意：纯文本下 `# Title` 也可能 contains "# Title"！

  **关键：先确认失败信号。** 纯文本渲染下 `setAnswer("# Title")` 输出 `# Title` 原样 → `toContain("# Title")` 恰好通过，这不是有效失败。真正先失败的应选用例：代码块用例（纯文本下 `` ```ts `` 与 `const x = 1;` 都原样输出，仍会通过）——同理。

  因此 Step 2 的用例若按原样先跑会误绿。**正确顺序：先做 Step 4 的实现（此时测试编译失败：`MarkdownTheme` 类型导入存在但 `new Markdown(...)` 尚未实现，测试文件本身可通过；跑测试看新用例与现有用例在 identity 注入下的行为），再跑全量测试确认绿。** 若个别新用例在 identity 主题下与组件实际输出不符（例如 paragraph 后追加空行导致行数断言变化），以组件实际输出为准调整断言。

  Run: `npx vitest run packages/pi-btw/btw-ui.test.ts`
  Expected: 现有用例全绿（identity 注入下布局语义不变），新用例绿或按组件实际输出微调断言后绿。

- [ ] **Step 4: 实现 btw-ui.ts**

  导入（`pi-coding-agent` 的 import 从纯 type 变为含值导入；pi-tui 增加 `Markdown` 与 `MarkdownTheme`）：

  ```ts
  import {
    type ExtensionCommandContext,
    type Theme,
    getMarkdownTheme,
  } from "@earendil-works/pi-coding-agent";
  import {
    type Component,
    Key,
    Markdown,
    type MarkdownTheme,
    type TUI,
    matchesKey,
    truncateToWidth,
    visibleWidth,
    wrapTextWithAnsi,
  } from "@earendil-works/pi-tui";
  ```

  类字段与构造器（追加第 8 个可选参数，默认主聊天同款主题）：

  ```ts
  private history: BtwTurn[];
  private readonly markdown: Markdown;
  ```

  ```ts
  constructor(
    private readonly question: string,
    history: BtwTurn[],
    private readonly theme: Theme,
    private readonly tui: TUI,
    private readonly done: (result?: undefined) => void,
    private readonly controller: AbortController,
    private readonly onClearHistory: () => void,
    markdownTheme: MarkdownTheme = getMarkdownTheme(),
  ) {
    this.history = [...history];
    this.markdown = new Markdown("", 0, 0, markdownTheme);
  }
  ```

  `setAnswer` 同步 markdown 文本（组件 `setText` 自动失效 text+width 缓存，`requestRender` 触发重绘）：

  ```ts
  setAnswer(text: string): void {
    this.mode = "answer";
    this.answer = text;
    this.markdown.setText(text);
    this.tui.requestRender();
  }
  ```

  `renderAnswer` 的 answer 分支替换为组件渲染（空文本时组件返回 `[]`，与现行为一致；行仍统一加 `ANSWER_PAD` 缩进）：

  ```ts
  return indent(this.markdown.render(bodyWidth));
  ```

  pending / error 分支不动。

- [ ] **Step 5: 运行测试验证全绿**

  Run: `npx vitest run packages/pi-btw`
  Expected: 全部通过。重点确认现有断言未破坏：
  - "wraps multi-line answers into the answer body"——marked 将 `line1\nline2\nline3` 作为一个 paragraph 的 text token，`applyTextWithNewlines` 保留 `\n`，仍 3 行。
  - setTrimmed 的 "exactly one notice line" / "line count unchanged"——`"answer-body"` 单段落渲染 1 行，行数 7/8 不变。
  - "clips top when content overflows"——answer 渲染 1 行，裁剪行为不变。

- [ ] **Step 6: 更新架构文档**

  在 `packages/pi-btw/docs/architecture.md` 的 Render order 图中：

  ```
  answer        — "…" while pending, the markdown-rendered answer, or the error in red
  ```

  并在 "History and echo use a 2-column left gutter; the answer body uses 4." 段落后补一句：

  ```
  The answer body is rendered as markdown with the same getMarkdownTheme() theme
  as the main chat — headings, inline formatting, fenced code blocks (with syntax
  highlighting when a language is tagged), links, lists and tables included. The
  question lines (banner, history, echo) and the error text stay plain.
  ```

- [ ] **Step 7: 提交**

  ```bash
  git add packages/pi-btw/btw-ui.ts packages/pi-btw/btw-ui.test.ts packages/pi-btw/docs/architecture.md
  git commit -m "feat(pi-btw): 答案正文按 markdown 渲染（主聊天同款主题）"
  ```

---

### Task 2: 版本升级 + 全仓验证

**Files:**

- Modify: `packages/pi-btw/package.json`（由 bump-version.mjs 处理，含 lockfile 同步）

**Interfaces:**

- Consumes: Task 1 的 btw-ui.ts / btw-ui.test.ts / architecture.md 变更。

- [ ] **Step 1: 升级版本 0.1.3 → 0.1.4**

  Run: `npm run version:patch -- pi-btw`
  Expected: `packages/pi-btw/package.json` 的 version 变为 0.1.4；`package-lock.json` 同步更新。

- [ ] **Step 2: 全仓测试 + 静态检查**

  Run: `npx vitest run`（全仓，含 65 个移植测试文件；`passWithNoTests` 不影响）
  Expected: 全绿。

  Run: `npx biome check --error-on-warnings packages/pi-btw`
  Expected: 无告警（注意：`--write` 不在验证时使用；格式问题手动修或按仓库惯例 `npm run check:files -- packages/pi-btw`）。

- [ ] **Step 3: 提交**

  ```bash
  git add packages/pi-btw/package.json package-lock.json
  git commit -m "chore(pi-btw): 0.1.3 → 0.1.4——答案正文 markdown 渲染"
  ```
