/**
 * bash 命令词法扫描器 —— 定位第一个「命令起始位置」的 sudo。
 *
 * 替代裸正则 `/\bsudo(?=\s)/` 的检测：正则会把 echo "sudo xxx"、注释、
 * heredoc 内容、git 提交信息等文本中的 sudo 误判为命令，导致白弹窗和
 * 文本污染。本扫描器按 bash 词法规则线性扫描：
 *
 * - 单引号/双引号/反引号内的 sudo 不命中（文本/数据，不执行）
 * - `#` 注释、heredoc 内容不命中（数据流）
 * - `$(...)` 命令替换、反引号内的 sudo **命中**（真实执行）
 * - `$((...))` 算术、`[[...]]` 条件上下文不命中（变量/条件，不执行）
 * - 命令分隔符（`;` `&&` `||` `|` `|&` `&` `(` `)` `{` `}` 换行）后的
 *   第一个词是 sudo 且后跟空白 → 命中（含 `VAR=x sudo cmd` 赋值前缀）
 * - 重定向（`>` `<`）不改变命令边界，`cat > sudo file` 不误命中
 */

/** 命令边界字符（空白 + 分隔符 + 重定向） */
const BOUNDARY = /[\s;|&(){}<>]/;

/** 赋值 token（NAME= 形式，如 DEBIAN_FRONTEND=noninteractive） */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export interface CommandSudoHit {
  /** sudo 的起始字符偏移 */
  index: number;
}

/** 定位第一个命令起始位置的 sudo；无则返回 null */
export function findCommandSudo(command: string): CommandSudoHit | null {
  return scan(command, 0, null).hit;
}

/**
 * 递归扫描 [start, n)，遇 stop 字符停止（子命令上下文用）。
 * 返回消费到的位置（stop 之后）与命中结果（如有）。
 */
function scan(command: string, start: number, stop: string | null): { end: number; hit: CommandSudoHit | null } {
  const n = command.length;
  let i = start;
  let atStart = true; // 当前位置是否等待命令的第一个词

  while (i < n) {
    const c = command[i];

    // 子命令/反引号上下文的终止字符
    if (stop && c === stop) {
      return { end: i + 1, hit: null };
    }

    // 注释：词首的 #（前一个是边界或行首）
    if (c === "#" && (i === start || BOUNDARY.test(command[i - 1]))) {
      while (i < n && command[i] !== "\n") i++;
      continue;
    }

    // 引号
    if (c === "'") {
      i = skipSingleQuote(command, i);
      continue;
    }
    if (c === '"') {
      const sub = scanDoubleQuote(command, i);
      if (sub.hit) return { end: sub.end, hit: sub.hit };
      i = sub.end;
      continue;
    }

    // $ 引导的结构
    if (c === "$") {
      const next = command[i + 1];
      // $((...)) 算术展开：跳过（内部不是命令）
      if (next === "(" && command[i + 2] === "(") {
        i = skipArithmetic(command, i + 2);
        continue;
      }
      // $(...) 命令替换：递归扫描（内部 sudo 真实执行）
      if (next === "(") {
        const sub = scan(command, i + 1, ")");
        if (sub.hit) return { end: sub.end, hit: sub.hit };
        i = sub.end;
        continue;
      }
      // $'...' ANSI-C 引号 / $"..." 本地化字符串：当引号跳过
      if (next === "'") {
        i = skipSingleQuote(command, i + 1);
        continue;
      }
      if (next === '"') {
        const sub = scanDoubleQuote(command, i + 1);
        if (sub.hit) return { end: sub.end, hit: sub.hit };
        i = sub.end;
        continue;
      }
      // ${...} 参数展开等：走 word 收集（`${sudo}` 不是命令）
    }

    // 反引号命令替换
    if (c === "`") {
      const sub = scan(command, i + 1, "`");
      if (sub.hit) return { end: sub.end, hit: sub.hit };
      i = sub.end;
      continue;
    }

    // [[...]] 条件表达式：跳过（内部不是命令）
    if (c === "[" && command[i + 1] === "[") {
      i = skipDoubleBracket(command, i + 2);
      continue;
    }

    // heredoc：<<EOF（含 <<'EOF' / <<-EOF 变体）；<<< here-string 按普通词处理
    if (c === "<" && command[i + 1] === "<" && command[i + 2] !== "<") {
      i = skipHeredoc(command, i + 2);
      atStart = true; // 定界符行之后是新命令上下文
      continue;
    }

    // 命令边界：重置「等待命令词」状态（空白/重定向不重置）
    if (BOUNDARY.test(c)) {
      if (c !== " " && c !== "\t" && c !== ">" && c !== "<") atStart = true;
      i++;
      continue;
    }

    // 普通词
    const j = collectWord(command, i);
    const word = command.slice(i, j);
    if (atStart) {
      if (ASSIGNMENT.test(word)) {
        // 赋值前缀（VAR=x）：不消耗命令起始，继续等待命令词
        i = j;
        continue;
      }
      // 命令起始位置的 sudo，且后跟空白（保证是命令而非行尾裸词）
      if (word === "sudo" && j < n && /\s/.test(command[j])) {
        return { end: j, hit: { index: i } };
      }
      atStart = false;
    }
    i = j;
  }
  return { end: n, hit: null };
}

/** 跳过单引号串（含 $'...' 的转义变体），返回闭引号后的位置 */
function skipSingleQuote(command: string, i: number): number {
  const n = command.length;
  i++; // 开引号
  while (i < n && command[i] !== "'") {
    // $'...' 内支持 \' \\ 等转义；'...' 内无反义
    if (command[i] === "\\" && i + 1 < n) i += 2;
    else i++;
  }
  return i + 1; // 闭引号（可能越界，主循环自然终止）
}

/** 跳过双引号串，返回闭引号后的位置；双引号内 $(...) 子命令递归扫描 */
function scanDoubleQuote(command: string, i: number): { end: number; hit: CommandSudoHit | null } {
  const n = command.length;
  i++; // 开引号
  while (i < n) {
    const c = command[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === '"') {
      return { end: i + 1, hit: null };
    }
    if (c === "$" && command[i + 1] === "(" && command[i + 2] !== "(") {
      const sub = scan(command, i + 1, ")");
      if (sub.hit) return { end: sub.end, hit: sub.hit };
      i = sub.end;
      continue;
    }
    i++;
  }
  return { end: n, hit: null };
}

/** 跳过 $((...)) 算术展开（括号计数），返回结束后的位置 */
function skipArithmetic(command: string, i: number): number {
  const n = command.length;
  let depth = 0;
  while (i < n) {
    const c = command[i];
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0 && command[i + 1] === ")") return i + 2;
      if (depth > 0) depth--;
    }
    i++;
  }
  return n;
}

/** 跳过 [[...]] 条件表达式，返回 ]] 后的位置 */
function skipDoubleBracket(command: string, i: number): number {
  const n = command.length;
  while (i < n) {
    if (command[i] === "]" && command[i + 1] === "]") return i + 2;
    i++;
  }
  return n;
}

/**
 * 跳过 heredoc（<< 后的定界符 + 内容行），返回定界符行之后的位置。
 * 定界符支持 <<EOF / <<'EOF' / <<"EOF" / <<-EOF / <<\EOF 变体。
 */
function skipHeredoc(command: string, i: number): number {
  const n = command.length;

  // 读定界符
  let j = i;
  while (j < n && (command[j] === " " || command[j] === "\t")) j++;
  if (command[j] === "-") j++; // <<-：内容行允许前导 tab
  let delim = "";
  const d0 = command[j];
  if (d0 === "'" || d0 === '"') {
    j++;
    while (j < n && command[j] !== d0) {
      delim += command[j];
      j++;
    }
    j++; // 闭引号
    while (j < n && command[j] !== "\n") j++; // 定界符后到行尾
  } else {
    while (j < n && !BOUNDARY.test(command[j]) && command[j] !== "\\") {
      delim += command[j];
      j++;
    }
    // 定界符后到行尾
    while (j < n && command[j] !== "\n") j++;
  }
  if (!delim) return j; // 无定界符（<< 后直接换行），放弃跳过

  // 逐行跳过内容，直到定界符行
  let lineStart = j < n ? j + 1 : n; // 内容从定界符行之后开始
  while (lineStart < n) {
    let k = lineStart;
    while (command[k] === "\t") k++; // <<- 变体允许前导 tab
    if (command.startsWith(delim, k)) {
      const after = k + delim.length;
      if (after >= n || command[after] === "\n" || command[after] === " " || command[after] === "\t") {
        // 定界符行：跳到该行尾之后
        j = after;
        while (j < n && command[j] !== "\n") j++;
        return j < n ? j + 1 : n;
      }
    }
    const nl = command.indexOf("\n", lineStart);
    if (nl === -1) return n;
    lineStart = nl + 1;
  }
  return n;
}

/** 收集一个词（到边界/引号/命令替换为止），返回词尾位置 */
function collectWord(command: string, i: number): number {
  const n = command.length;
  while (i < n) {
    const c = command[i];
    if (BOUNDARY.test(c)) break;
    if (c === "'" || c === '"' || c === "`") break;
    if (c === "$" && (command[i + 1] === "(" || command[i + 1] === "'" || command[i + 1] === '"')) break;
    i++;
  }
  return i;
}
