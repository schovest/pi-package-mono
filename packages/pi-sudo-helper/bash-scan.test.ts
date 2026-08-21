import { describe, expect, it } from "vitest";
import { classifySudoUsage, findAllCommandSudo, findCommandSudo } from "./bash-scan.ts";

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

describe("findAllCommandSudo — 所有命令位置 sudo", () => {
  it("无 sudo", () => {
    expect(findAllCommandSudo("echo hi")).toEqual([]);
  });

  it("单个 sudo", () => {
    expect(findAllCommandSudo("sudo apt update")).toEqual([{ index: 0 }]);
  });

  it("多个裸 sudo（&& 分隔）", () => {
    expect(findAllCommandSudo("sudo a && sudo b")).toHaveLength(2);
    expect(findAllCommandSudo("sudo a && sudo b")[0]).toEqual({ index: 0 });
  });

  it("管道分隔多个", () => {
    expect(findAllCommandSudo("sudo a | sudo b | sudo c")).toHaveLength(3);
  });

  it("引号/文本内 sudo 不重复计数", () => {
    const cmd = 'echo "sudo x"; sudo y';
    expect(findAllCommandSudo(cmd)).toEqual([{ index: cmd.lastIndexOf("sudo y") }]);
  });

  it("heredoc 内容不计入多个 sudo", () => {
    const cmd = "sudo cat <<EOF\nsudo fake\nEOF\nsudo real";
    expect(findAllCommandSudo(cmd)).toHaveLength(2);
  });
});

describe("classifySudoUsage — 使用结构标记", () => {
  it("单个 sudo 无标记", () => {
    const cmd = "sudo apt update";
    expect(classifySudoUsage(cmd, findAllCommandSudo(cmd))).toEqual({
      multiSudo: false,
      nonInteractive: false,
      bashDashCDoubleQuote: false,
    });
  });

  it("多裸 sudo → multiSudo", () => {
    const cmd = "sudo a && sudo b";
    expect(classifySudoUsage(cmd, findAllCommandSudo(cmd)).multiSudo).toBe(true);
  });

  it("sudo -n / --non-interactive → nonInteractive", () => {
    for (const cmd of ["sudo -n true", "sudo -n apt update", "sudo --non-interactive apt update"]) {
      expect(classifySudoUsage(cmd, findAllCommandSudo(cmd)).nonInteractive).toBe(true);
    }
  });

  it("apt 自身 -n 选项不误判 nonInteractive", () => {
    const cmd = "sudo apt install -n foo";
    expect(classifySudoUsage(cmd, findAllCommandSudo(cmd)).nonInteractive).toBe(false);
  });

  it('sudo bash -c "..." 双引号包裹 → bashDashCDoubleQuote', () => {
    const cmd = 'sudo bash -c "systemctl restart a"';
    expect(classifySudoUsage(cmd, findAllCommandSudo(cmd)).bashDashCDoubleQuote).toBe(true);
  });

  it("sudo bash -c '...' 单引号不标记", () => {
    const cmd = "sudo bash -c 'systemctl restart a'";
    expect(classifySudoUsage(cmd, findAllCommandSudo(cmd)).bashDashCDoubleQuote).toBe(false);
  });
});
