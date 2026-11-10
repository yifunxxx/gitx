import { expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";

it("parses split UTF-8 and ANSI output, answers cursor queries, and bounds scrollback", async () => {
  const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 100 });
  const replies: string[] = [];
  const subscription = terminal.onData((data) => replies.push(data));
  const write = (data: Uint8Array | string) => new Promise<void>((done) => terminal.write(data, done));
  try {
    const bytes = new TextEncoder().encode("\x1b[31m中文 😀\x1b[0m");
    await write(bytes.slice(0, 6));
    await write(bytes.slice(6));
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("中文 😀");
    await write("\x1b[6n");
    expect(replies.some((reply) => /^\x1b\[1;\d+R$/.test(reply))).toBe(true);
    await write(Array.from({ length: 5000 }, (_, i) => `\r\nline ${i}`).join(""));
    expect(terminal.buffer.active.length).toBeLessThanOrEqual(124);
    expect(terminal.buffer.active.getLine(terminal.buffer.active.length - 1)?.translateToString(true)).toBe("line 4999");
  } finally { subscription.dispose(); terminal.dispose(); }
});
