/** Strip ANSI escape sequences from a string. */
function stripAnsi(str: string): string {
  // Matches ANSI escape sequences: ESC [ <params> m  (and other CSI/OSC sequences)
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/** Get the first line of text, optionally stripping ANSI codes. */
function firstLine(text: string, strip = false): string {
  const idx = text.indexOf("\n");
  const first = idx === -1 ? text : text.substring(0, idx);
  return strip ? stripAnsi(first) : first;
}

export function cleanContextMessages(messages: any[]): any[] {
  return messages.map(m => {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      return {
        ...m,
        content: m.content.map((b: any) => {
          if (b.type === "text" && typeof b.text === "string") {
            // Check if the first line (with ANSI stripped and trimmed) starts with "⚡ "
            const cleanedFirstLine = firstLine(b.text, true).trim();
            if (cleanedFirstLine.startsWith("⚡ ")) {
              const newlineIndex = b.text.indexOf("\n");
              if (newlineIndex !== -1) {
                return { ...b, text: b.text.substring(newlineIndex + 1) };
              } else {
                return { ...b, text: "" };
              }
            }
          }
          return b;
        }),
      };
    }
    return m;
  });
}
