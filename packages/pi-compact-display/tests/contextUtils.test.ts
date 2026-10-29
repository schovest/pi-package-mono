import { describe, expect, it } from "vitest";
import { cleanContextMessages } from "../src/contextUtils.ts";

describe("cleanContextMessages", () => {
  it("should remove summary line from assistant messages", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "⚡ read(1)\nHello" }],
      },
    ];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content[0].text).toBe("Hello");
  });

  it("should not remove lines starting with ⚡ if they are not at the very beginning", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Hello\n⚡ read(1)\nWorld" }],
      },
    ];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content[0].text).toBe("Hello\n⚡ read(1)\nWorld");
  });

  it("should handle messages without content array", () => {
    const messages = [{ role: "user", content: "Hello" }];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content).toBe("Hello");
  });

  it("should remove summary line styled with ANSI escape codes", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "\x1b[48;5;22m⚡ read(1)\x1b[49m\nHello world" }],
      },
    ];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content[0].text).toBe("Hello world");
  });

  it("should remove themed summary line with leading spaces and ANSI escape codes", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "\x1b[48;2;40;50;40m ⚡ edit(2)  \x1b[49m\nHello" }],
      },
    ];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content[0].text).toBe("Hello");
  });

  it("should handle a standalone themed summary line with leading spaces (no trailing newline)", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "\x1b[48;2;40;50;40m ⚡ edit(2)  \x1b[49m" }],
      },
    ];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content[0].text).toBe("");
  });

  it("should handle a standalone ANSI-styled summary line (no trailing newline)", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "\x1b[48;5;22m⚡ read(1)\x1b[49m" }],
      },
    ];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content[0].text).toBe("");
  });

  it("should not remove ANSI-styled lines that are not summaries", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Some text\n\x1b[32m⚡ read(1)\x1b[39m\nMore" }],
      },
    ];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content[0].text).toBe("Some text\n\x1b[32m⚡ read(1)\x1b[39m\nMore");
  });

  it("should leave assistant messages intact if no summary exists", () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: "Just some text" }] }];
    const cleaned = cleanContextMessages(messages);
    expect(cleaned[0].content[0].text).toBe("Just some text");
  });
});
