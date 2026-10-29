import fs from "fs";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRenderingExtension } from "./renderingHarness.ts";

vi.mock("fs");

// 実 ToolExecutionComponent と登録された renderer resolver を使った統合テスト。
describe("lines-mode result rendering (registered renderer)", () => {
  let makeComponent: ReturnType<typeof loadRenderingExtension>;

  beforeEach(() => {
    vi.resetAllMocks();
    initTheme("dark");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        write: { mode: "lines" },
        edit: { mode: "lines" },
      }),
    );
    makeComponent = loadRenderingExtension();
  });

  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

  it("should show the error message, not the attempted payload, when write fails (I1)", () => {
    const t = makeComponent("write", "1", { path: "/root/x.txt", content: "SECRET_PAYLOAD" });
    t.updateResult({ content: [{ type: "text", text: "EACCES: permission denied" }], isError: true });
    const out = strip(t.render(80).join("\n"));
    expect(out).toContain("EACCES: permission denied");
    expect(out).not.toContain("SECRET_PAYLOAD");
  });

  it("should show the written content, not the host metadata, when write succeeds (I1)", () => {
    const t = makeComponent("write", "2", { path: "/tmp/x.txt", content: "written line 1" });
    t.updateResult({ content: [{ type: "text", text: "Successfully wrote 13 bytes" }], isError: false });
    const out = strip(t.render(80).join("\n"));
    expect(out).toContain("written line 1");
    expect(out).not.toContain("Successfully wrote");
  });

  it("should not leak host metadata when the written content is empty (I3)", () => {
    const t = makeComponent("write", "3", { path: "/tmp/empty.txt", content: "" });
    t.updateResult({
      content: [{ type: "text", text: "Successfully wrote 0 bytes to /tmp/empty.txt" }],
      isError: false,
    });
    const out = strip(t.render(80).join("\n"));
    expect(out).not.toContain("Successfully wrote");
  });

  it("should show the error message when edit fails (I1)", () => {
    const t = makeComponent("edit", "4", { path: "/a.ts", edits: [{ oldText: "foo", newText: "bar" }] });
    t.updateResult({ content: [{ type: "text", text: "Could not find the exact text in /a.ts." }], isError: true });
    const out = strip(t.render(80).join("\n"));
    expect(out).toContain("Could not find the exact text in /a.ts.");
  });
});
