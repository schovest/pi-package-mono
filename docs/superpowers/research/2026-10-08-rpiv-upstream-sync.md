# 上游同步调研：rpiv-todo / rpiv-ask-user-question 2.4.0 → 2.12.0

- 日期：2026-10-08
- 上游：[juicesharp/rpiv-mono](https://github.com/juicesharp/rpiv-mono)，`@juicesharp/rpiv-todo` 与 `@juicesharp/rpiv-ask-user-question`
- 本地基线：全量移植自上游 **2.4.0**（2026-08-03），此后未同步
- 上游现状：两包同步发版至 **2.12.0**（2026-09-30），期间共 14 个版本
- 调研方法：npm tarball（2.4.0 vs 2.12.0）逐文件 diff + 上游 CHANGELOG（raw.githubusercontent）+ 本地包 vs 上游 2.4.0 的语义 diff（`diff -uw`，忽略 Biome 格式化噪音）

## 一、本地定制面（合并时必须保留）

两包本地相对上游 2.4.0 的语义差异极小，全部可枚举：

| 类别 | 内容 | 涉及文件 |
| --- | --- | --- |
| 改名 | `@juicesharp/rpiv-i18n` → `@schovest/pi-i18n`、`@juicesharp/rpiv-config` → `@schovest/pi-config`；`I18N_NAMESPACE` 改为 `@schovest/pi-*` | index.ts、state/i18n-bridge.ts、config.ts |
| 本地 feature | `rpiv:ask-user:aborted` 事件（0.2.0）：TUI Esc / RPC 关闭时发 `{ aborted: true }`；事件名字面量按移植约定保留 `rpiv:` 前缀 | ask-user-question.ts、events.ts、index.ts |
| manifest | typebox 移 peer `"*"`（0.1.4 / 0.2.1，与上游 2.12.0 #282 同一改动） | package.json |
| 格式化 | Biome：2 空格缩进、import 排序、120 行宽 | 全部 .ts |

无其他逻辑改动。两包其余全部语义行为与上游 2.4.0 一致。

## 二、pi-todo 上游变更清单（2.4.0 → 2.12.0）

| 上游版本 | 类型 | 内容 | 合并价值 |
| --- | --- | --- | --- |
| **2.5.0** (#151,#152) | 安全修复 | 新增 `tool/sanitize.ts`：`sanitizeTerminalText()` 剥离模型可控任务文本（subject/description/activeForm/owner）中的 CSI/OSC 转义序列、控制字符、bidi 控制符，防终端注入/布局破坏。应用于 `tool/response-envelope.ts`（list/get/create/delete 输出）与 `view/format.ts`（overlay 行、renderCall echo） | ⭐⭐ 建议合并 |
| **2.6.2** (#154) | 行为修复 | ① prompt guideline 文案：`When starting a task from the todo list` 替代 `When starting any task`——否则会压过 Pi 的「单条琐碎任务不建 todo」规则，模型给每个请求都建单任务清单（`todo.ts` 一行）；② overlay 跟随 Pi 的 tool-output 展开模式：`this.uiCtx?.getToolsExpanded?.() === true` 时不截断（`todo-overlay.ts` 一处，optional chaining 向后兼容旧 host） | ⭐⭐ 建议合并 |
| 2.6.1 | 包装 | `pi.image` 指向上游 repo 的 cover.png（pi.dev 包卡片用） | ❌ 不适用（指向别家 repo） |
| 2.12.0 (#282) | manifest | typebox 移 peer `"*"` | ✅ 本地已做，跳过 |
| — | 注释 | state 三文件 + types.ts 移除 pre-refactor 注释引用 | 低（可顺手） |

locale 无变化。上游 diff 总量：新文件 1 个 + 6 个文件改动，其中实质逻辑仅 sanitize 应用点与 overlay/guideline 两处。

**冲突评估：低。** 上游改动文件与本地定制（改名集中在 i18n-bridge/index/config）不重叠；`todo-overlay.ts:173` 与上游修改点逐字对应，可直接套用。

## 三、pi-ask-user-question 上游变更清单（2.4.0 → 2.12.0）

| 上游版本 | 类型 | 内容 | 合并价值 |
| --- | --- | --- | --- |
| **2.5.1** (#160) | 修复 | 「Type something」与 note 的长粘贴文本完整传递给模型，不再折叠成编辑器 `[paste #N +L lines]` 标记，切 tab 后也不丢 | ⭐⭐ 建议合并 |
| **2.5.2** (#156) | 修复 | 尊重重映射的 `tui.input.submit` 确认键（如 enter 折叠进 newLine、submit 移到 ctrl+enter 的配置）；此前这类配置下对话框没有任何可用确认键，按 submit 会静默清掉草稿 | ⭐ 未自定义键位则无感 |
| **2.6.0** (#140) | 新增 | 开始等待输入时向 TTY 写一个 BEL（`\x07`），响铃/闪烁交给终端配置；非 TTY/RPC 不发 | ⭐ 小而有用地 |
| **2.6.1** | 新增 | `guidance.description` 配置项：非空字符串整体替换内置工具 description（不合并）；另加 `pi.image`（❌ 不适用） | ⭐ description 覆盖有用 |
| **2.6.3** (#176) | 修复 | 对话框 footer hint 显示实际配置的 collapseKey（`Alt+O to collapse`）而非硬编码 `Ctrl+]`，`off` 时整行省略；复合键规范显示（`Ctrl+PageDown`）；无 raw terminal input 的 host 上折叠回退为可见单行（避免不可逆隐藏） | ⭐ 建议合并 |
| **2.7.0** (#182) | **功能** | Submit tab 按 `n` 附加**全局 note**：以 `global note: <text>` 尾段 + `details.globalNote` 到达模型，切 tab 保留，不算已答；全部问题留白但有 note 时提交返回 answered envelope 而非 decline；note 仅 TUI 可用（RPC/ACP 原生对话框无此字段）。触及 state.ts/state-reducer/key-router/questionnaire-session/projections/dialog-builder/submit-picker/tab-content-strategy 等 9+ 文件 | ⭐⭐ 最大件 |
| **2.10.0** (#192) | 稳健性 | 新增 `tool/normalize-params.ts`：工具入口处对模型提供的全部文本字段（question/header/label/description/preview）做 CR 规范化（`\r\n`→`\n`，孤立 `\r` 删除）——防裸 CR 碎片化 option 行、绕过保留标签校验；在 validate 之前跑，TUI/RPC/envelope/事件全链路吃到干净文本 | ⭐⭐ 建议合并 |
| 2.12.0 (#282) | manifest | typebox 移 peer `"*"` | ✅ 本地已做，跳过 |

locale：en.json 改 2 个 hint 键为 `{key}` 占位符 + 新增 3 个 global-note 键（`review.global_hint` / `review.note_label` / `notes.global_header`）；**zh.json 上游只改了 `{key}` 占位符，未补 global-note 翻译**（上游靠 en fallback）——本地 zh.json 是全量翻译，合并时需自行补 3 个中文键。

**冲突评估：中。** 上游大改的 `ask-user-question.ts`（300 行 diff）与本地 aborted 事件改动同文件但不同 hunk；`key-router.ts`（250 行 diff）本地无定制。真正的麻烦是格式化差异（tab vs 2 空格 + import 排序）会让 git 三方合并噪音极大。

## 四、合并策略建议

**推荐：以上游 2.12.0 tarball 为基线重放本地定制，而非把上游 hunk 反向移植到本地文件。**

1. 用上游 2.12.0 源码覆盖 `src`，然后重放已知很小的本地定制：
   - 三处 import/namespace 改名（sed 级别）；
   - AUQ 重放 aborted 事件（本地 0.2.0 的三个 hunk，上游对应位置无冲突）；
   - package.json 按本地模板（包名、`pi.extensions`、peer 结构、`@schovest/pi-config` 依赖）；
   - zh.json 补 global-note 中文翻译；
   - 跑 `biome format` + 全量测试（移植测试已随包搬运，上游 2.7.0/2.10.0 配套的测试逻辑可从上游 GitHub HEAD 的 tests/ 对照补齐——tarball 不含 tests）。
2. 不适用项直接丢弃：`pi.image`、上游 package.json 其余字段。
3. 版本：两包各升 **minor**（pi-todo 0.2.0、pi-ask-user-question 0.3.0，AUQ 有新 feature）。

替代方案（不建议）：在本地文件上手工套上游 hunk。pi-todo 可行（变更小），但 AUQ 的 2.7.0 触及 9+ 文件且本地格式化差异会逐文件制造假冲突，工作量和漏移风险都更高。

## 五、需要用户决策的点

1. **是否合并**：建议至少合并两包的全部 ⭐⭐ 项（todo sanitize + guideline；AUQ 全局 note + CR 规范化 + 粘贴修复）。
2. **合并粒度**：全部实质变更一次到位（推荐，重放成本固定），还是只挑安全/行为修复（2.5.0/2.6.2/2.10.0）跳过 2.7.0 大 feature。
3. **zh.json**：global note 的 3 个键是否由我们补中文翻译（上游没有）。

## 附：证据来源

- 上游 CHANGELOG：`https://raw.githubusercontent.com/juicesharp/rpiv-mono/main/packages/{rpiv-todo,rpiv-ask-user-question}/CHANGELOG.md`
- tarball diff：`/tmp/rpiv-diff/rpiv-{todo,ask-user-question}-{2.4.0,2.12.0}/`（npm pack，2026-10-08 拉取）
- 本地语义 diff：`diff -uw /tmp/rpiv-diff/<up-2.4.0> packages/<pkg>`（忽略空白后仅上表所列差异）
