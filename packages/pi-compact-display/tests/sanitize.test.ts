import { describe, expect, it } from "vitest";
import { sanitizeBinaryOutput, sanitizeToolText, stripAnsi } from "../src/sanitize.ts";

describe("stripAnsi", () => {
  it("should keep plain text unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
    expect(stripAnsi("")).toBe("");
  });

  it("should strip CSI SGR color sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
    expect(stripAnsi("\x1b[1;31mbold red\x1b[39m")).toBe("bold red");
  });

  it("should strip OSC-8 hyperlink sequences", () => {
    const input = "\x1b]8;;http://example.com\x1b\\link\x1b]8;;\x1b\\";
    expect(stripAnsi(input)).toBe("link");
  });

  it("should strip 8-bit CSI introducer sequences", () => {
    expect(stripAnsi("a\x9b31mb\x9bm")).toBe("ab");
  });
});

describe("sanitizeBinaryOutput", () => {
  it("should keep normal text and whitespace", () => {
    expect(sanitizeBinaryOutput("hello\tworld\nnext\r\n")).toBe("hello\tworld\nnext\r\n");
  });

  it("should remove control characters except tab/newline/CR", () => {
    expect(sanitizeBinaryOutput("a\x00b\x1fc\x1bd")).toBe("abcd");
    expect(sanitizeBinaryOutput("\x7f")).toBe("\x7f"); // 0x7f is DEL, not <= 0x1f
  });

  it("should remove Unicode format characters (U+FFF9–U+FFFB)", () => {
    expect(sanitizeBinaryOutput("a\uFFF9b\uFFFBc")).toBe("abc");
  });
});

describe("sanitizeToolText", () => {
  it("should combine ANSI stripping, control-char removal and CR removal", () => {
    const input = "\x1b[31mred\x1b[0m\x00\x01plain\r\nline2";
    expect(sanitizeToolText(input)).toBe("redplain\nline2");
  });

  it("should keep tab and newline", () => {
    expect(sanitizeToolText("a\tb\nc")).toBe("a\tb\nc");
  });
});
