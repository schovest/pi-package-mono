# pi-sudo-helper 改造成反应式提示 — 设计文档

日期：2026-08-21
状态：已批准（用户确认「去掉常驻提示词，改成反应式」）

## 背景

现 `pi-sudo-helper` 采用**预防式**设计：`before_agent_start` 往系统提示词追加
`SUDO_HELPER_PROMPT`，常驻教导 AI 用 `sudo bash -c '<整条命令>'` 格式、禁 `sudo -n` 探测、
一条命令只放一个 sudo。提示词每轮都注入，占 context，且 AI 一旦不按格式来（`sudo a && sudo b`、
`sudo bash -c "..."` 双引号、`sudo -n`），helper 只对**第一条** sudo 注入密码，其余依赖
sudoers timestamp，失败时没有任何引导。

目标：**去掉常驻提示词**，改为**反应式**——`tool_call` 用 `bash-scan` 检测到 bash-sudo 模式时
记录上下文；sudo 执行**失败**时，在 `tool_result` 里把「报错片段 + `sudo bash -c ''` 格式建议」
追加到 agent 可见的内容，让 AI 下一轮自我纠正。

## 现状机制（保留的部分）

- `tool_call`：bash-scan 定位第一个命令位置的 sudo → `sudo -n true` 预检（timestamp 有效则跳过）→
  `/dev/shm` 建 FIFO + askpass 脚本 → 弹遮罩密码框（XOR 加密）→ 只把**第一条** sudo 改写为
  `SUDO_ASKPASS='<script>' sudo -A` → 注册 60s 兜底清理。
- `tool_result`：清理该 toolCallId 的 FIFO/脚本/cat 进程。
- 安全：密码不落盘（tmpfs）、不出现在 ps/proc、不传 agent、用完物理清零。

密码注入逻辑整体保留，不动。

## 关键事实（实现依据）

- `tool_result` 事件的 `input.command` 是**改写后**的命令（`SUDO_ASKPASS=... sudo -A ...`），
  不是 AI 原始命令——agent-core 用同一个被原地改写的 args 执行并把它传给 `tool_result`
  （`agent-loop.js` `finalizeExecutedToolCall` 传 `prepared.args`）。
  ⇒ 反应式分析所需的原始命令必须**在 `tool_call` 时按 toolCallId 缓存**。
- 失败信号：bash 非零退出时工具抛错，`isError=true`，`content` 为 `"<输出>\n\nCommand exited
  with code N"`。`tool_result` handler 可返回 `{ content: [...event.content, {type:"text",
  text: 提示}] }` 追加热文本块。`ToolResultEventResult` 支持 `content` 覆盖（已验证）。
- 用户取消弹窗时 `tool_call` 返回 `{ block: true }`；`tool_result` 仍会以 `isError=true` 触发，
  需在取消分支删除缓存，避免对「用户主动取消」追加提示。

## 方案

### 1. 删除常驻提示词

移除 `before_agent_start` 处理器与 `SUDO_HELPER_PROMPT` 常量。

### 2. `bash-scan.ts` 扩展（可单测）

- `findAllCommandSudo(command): CommandSudoHit[]` —— 复用现有 `scan` 词法（跳过引号/注释/
  heredoc/文本里的 sudo），从 `command` 全部命令位置 sudo 的索引。实现：循环 `scan(command, start)`
  收集，`start = hit.index + "sudo".length`（命中点后必为空白，重扫从命令边界重启）。
- `findAllCommandSudo(command)` 返回的索引做结构分类，新增：

  ```ts
  interface SudoUsageFlags {
    multiSudo: boolean;              // 命中 ≥2 处 sudo
    nonInteractive: boolean;         // sudo 后选项簇含 -n（sudo -n / -vn 探测）
    bashDashCDoubleQuote: boolean;   // sudo bash -c "..." 外层双引号
  }
  classifySudoUsage(command, hits): SudoUsageFlags
  ```

  `-n` 判定：取 sudo 后最多 3 个空白分隔 token，在仍处于 `-` 开头选项阶段时，若某 token 以
  `-n` 开头则命中（`sudo apt ... -n` 首 token 非 `-` 不命中）。双引号判定：
  `^bash(...-c\s*"` / `^env( )+bash(...-c\s*"` 前缀匹配。

### 3. `index.ts` 反应式

- `tool_call`：
  - 改用 `findAllCommandSudo`，无命中 / `hasUI=false` → 原样返回。
  - **新增缓存**：`const callCtx = new Map<toolCallId, { command: string }>()`，
    只要命中 sudo 且 hasUI=true 即记录**原始命令**（在预检之前，无论免密与否）。
  - 预检、FIFO/askpass/弹窗/改写第一条 sudo 逻辑保持不变（用 `hits[0]`）。
  - 用户取消分支：追加 `callCtx.delete(toolCallId)`。
- `tool_result`：
  - 保留资源清理。
  - **新增反应式**：`toolName==="bash" && isError===true` 时查 `callCtx`；无记录 → 跳过。
    有记录 → `buildSudoHint(info, event.content)`，生成提示则
    `return { content: [...event.content, { type: "text", text: 提示 }] }`。
    无论是否提示，最后 `cleanupResources(toolCallId)` + `callCtx.delete(toolCallId)`。
  - `isError=false`（成功）→ 不提示。

### 4. 提示文本（门控：仅结构问题时提示）

```
🔐 sudo-helper：检测到 sudo 命令执行失败。

- 失败片段：
  <从输出提取的 sudo 相关报错 1~5 行>

- 原始命令：<AI 写的原命令>

- 原因与建议（按命中的标记给，可多条）：
  · 一条命令出现多个 sudo → 合并成：sudo bash -c '<整条命令>'
    （外层单引号，命令内部字符串用双引号；一条 bash 只放一个 sudo 且以 sudo 开头）
  · 用了 sudo -n → 别探测：直接 sudo ... 即可，helper 会自动弹窗注入密码
  · sudo bash -c "..." → 外层改用单引号，防止外层 shell 提前展开 $
```

**门控**：结构标记（multiSudo / nonInteractive / bashDashCDoubleQuote）全部未命中时
**不返回提示**——普通命令自身的失败、sudo 认证类报错（格式合规）都保持静默，不追加噪音。

报错片段提取（三级，有界 ≤5 行）：

1. 含认证特征的行——英文签名（`a password is required` / `not in the sudoers
   file` / `Sorry, try again` / `Authentication token` 等）+ 中文 zh_CN 本地化签名
   （`需要密码` / `不在 sudoers` / `请重试` / `密码不正确` / `令牌`）
2. 含 `sudo` 的行（`sudo:` / `sudo：` 前缀中英文一致，语言无关兜底）
3. 「Command exited」前的末几行非空行

### 5. 决策点（已定）

- **触发范围**：只在 sudo 结构问题（多裸 sudo / `sudo -n` 探测 / `sudo bash -c "..."`
  双引号包裹）时提示；命令自身失败与认证类报错静默。
- **hasUI 门控**：与现状一致，`hasUI=false` 不记录也不提示（无 UI 时连密码都无法注入，
  教 `sudo bash -c` 无意义）。
- **提示落点**：仅追加到 `tool_result` content（agent 可见自纠），不另发 UI 通知。

## 测试

- `index.test.ts` 重写：
  - 无 `before_agent_start` 注入（handler 不存在 / 不返回内容）。
  - 失败 + 多 sudo → content 追加且含 `sudo bash -c`；成功 → 不加。
  - 失败但无 callCtx（非 sudo / 未记录）→ 不加。
  - `sudo -n`、`sudo bash -c "..."` 失败 → 提示含对应话术。
- `bash-scan.test.ts` 追加：`findAllCommandSudo`（多 sudo / 引号内 sudo 不重复计数）、
  `classifySudoUsage`（-n、双引号、apt -n 不误判）用例。

## 发布

测试全绿后 `npm run version:patch -- pi-sudo-helper`（0.1.7 → 0.1.8），提交推送走 CI 发布。
