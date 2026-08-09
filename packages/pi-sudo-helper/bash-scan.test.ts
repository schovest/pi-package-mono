import { describe, expect, it } from "vitest";
import { findCommandSudo } from "./bash-scan.ts";

describe("findCommandSudo — 命令起始位置的 sudo 命中", () => {
  it("命令开头", () => {
    expect(findCommandSudo("sudo apt update")).toEqual({ index: 0 });
  });

  it("管道后", () => {
    expect(findCommandSudo("cat a | sudo base64")).toEqual({ index: 8 });
  });

  it("管道中后接继续管道", () => {
    expect(findCommandSudo("cat a | sudo base64 | grep x")).toEqual({ index: 8 });
  });

  it("赋值前缀后", () => {
    expect(findCommandSudo("DEBIAN_FRONTEND=noninteractive sudo apt -y install")).toEqual({
      index: "DEBIAN_FRONTEND=noninteractive ".length,
    });
  });

  it("多个 sudo 只取第一个", () => {
    expect(findCommandSudo("sudo a && sudo b")).toEqual({ index: 0 });
  });

  it("换行分隔后的第二条命令", () => {
    expect(findCommandSudo("foo &&\nsudo bar")).toEqual({ index: 7 });
  });

  it("子 shell 括号内", () => {
    expect(findCommandSudo("( sudo -u root ls )")).toEqual({ index: 2 });
  });

  it("命令组括号内", () => {
    expect(findCommandSudo("{ sudo ls; }")).toEqual({ index: 2 });
  });
});

describe("findCommandSudo — 文本中的 sudo 不命中", () => {
  it("双引号字符串", () => {
    expect(findCommandSudo('echo "sudo xxx"')).toBeNull();
  });

  it("单引号字符串", () => {
    expect(findCommandSudo("echo 'sudo xxx'")).toBeNull();
  });

  it("git 提交信息场景", () => {
    expect(findCommandSudo('git commit -m "sudo 密码机制"')).toBeNull();
  });

  it("注释", () => {
    expect(findCommandSudo("# 运行 sudo apt\napt list")).toBeNull();
  });

  it("词中间的 #（非注释）", () => {
    expect(findCommandSudo("echo foo#sudo bar")).toBeNull();
  });

  it("heredoc 内容", () => {
    const cmd = "cat <<EOF\nsudo apt update\nEOF\nsudo real";
    expect(findCommandSudo(cmd)).toEqual({ index: cmd.lastIndexOf("sudo real") });
  });

  it("heredoc 引号定界符内容", () => {
    expect(findCommandSudo("cat <<'EOF'\nsudo apt update\nEOF\n")).toBeNull();
  });

  it("重定向目标名为 sudo", () => {
    expect(findCommandSudo("cat > sudo file")).toBeNull();
  });

  it("算术展开", () => {
    expect(findCommandSudo("echo $(( 1 + sudo ))")).toBeNull();
  });

  it("条件表达式", () => {
    expect(findCommandSudo("[[ sudo -x ]] && echo ok")).toBeNull();
  });

  it("参数展开不是命令", () => {
    expect(findCommandSudo("echo ${sudo}")).toBeNull();
  });

  it("sudo 是词的一部分", () => {
    expect(findCommandSudo("mysudo x")).toBeNull();
    expect(findCommandSudo("sudo-file x")).toBeNull();
    expect(findCommandSudo("SUDO x")).toBeNull();
  });

  it("sudo 后无空白（行尾/紧接分隔符）", () => {
    expect(findCommandSudo("echo a; sudo")).toBeNull();
    expect(findCommandSudo("sudo;echo a")).toBeNull();
  });

  it("sh -c 单引号嵌套脚本不误伤", () => {
    expect(findCommandSudo("sh -c 'sudo base64'")).toBeNull();
  });
});

describe("findCommandSudo — 子命令替换中的 sudo 命中（真实执行）", () => {
  it("$() 命令替换", () => {
    expect(findCommandSudo("echo $(sudo -n true)")).toEqual({ index: 7 });
  });

  it("双引号内的 $() 命令替换", () => {
    expect(findCommandSudo('echo "a $(sudo -n true) b"')).toEqual({ index: 10 });
  });

  it("反引号命令替换", () => {
    expect(findCommandSudo("echo `sudo -n true`")).toEqual({ index: 6 });
  });
});
