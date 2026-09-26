import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { discoverAgents } from "../../src/agents/agents.ts";
import { BUILTIN_AGENT_NAMES } from "../../src/agents/builtin-names.ts";

const REMOVED = [
  "claude-code",
  "claude-code-writer",
  "codex-exec",
  "codex-exec-writer",
  "cursor-agent",
  "cursor-agent-writer",
] as const;

function withHome<T>(home: string, run: () => T): T {
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return run();
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
  }
}

function writeAgent(dir: string, fileName: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), "---\nname: stray-agent\n---\nbody");
}

describe("fork: builtin 裁剪", () => {
  test("外部 CLI 适配器 builtin 已删除", () => {
    for (const name of REMOVED) {
      assert.ok(!(BUILTIN_AGENT_NAMES as readonly string[]).includes(name), `${name} 不应是 builtin`);
    }
  });

  test("agents/ 目录恰含 7 个保留 builtin", () => {
    const agentsDir = path.join(fileURLToPath(new URL("../../agents/", import.meta.url)));
    const files = fs
      .readdirSync(agentsDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    assert.deepEqual(files, [
      "delegate.md",
      "evidence-auditor.md",
      "oracle.md",
      "researcher.md",
      "reviewer.md",
      "scout.md",
      "worker.md",
    ]);
  });
});

describe("fork: 发现目录收敛", () => {
  test("不扫描 ~/.agents", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "fork-home-"));
    writeAgent(path.join(home, ".agents"), "stray-user.md");
    try {
      withHome(home, () => {
        const discovered = discoverAgents(home, "user");
        assert.ok(!discovered.agents.some((a) => a.name === "stray-agent"));
        assert.ok(!discovered.directories.some((d) => d.path === path.resolve(home, ".agents")));
      });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test("不扫描 <root>/.agents", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fork-project-"));
    writeAgent(path.join(root, ".agents"), "stray-project.md");
    try {
      withHome(root, () => {
        const discovered = discoverAgents(root, "project");
        assert.ok(!discovered.agents.some((a) => a.name === "stray-agent"));
        assert.ok(!discovered.directories.some((d) => d.path === path.resolve(root, ".agents")));
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("正向对照：<root>/.pi/agents 与 ~/.pi/agent/agents 仍被扫描", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "fork-pos-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "fork-pos-proj-"));
    writeAgent(path.join(home, ".pi", "agent", "agents"), "in-user-dir.md");
    writeAgent(path.join(project, ".pi", "agents"), "in-project-dir.md");
    try {
      withHome(home, () => {
        const userSide = discoverAgents(project, "user");
        assert.ok(userSide.directories.some((d) => d.path === path.resolve(home, ".pi", "agent", "agents")));
        const projectSide = discoverAgents(project, "project");
        assert.ok(projectSide.directories.some((d) => d.path === path.resolve(project, ".pi", "agents")));
      });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
