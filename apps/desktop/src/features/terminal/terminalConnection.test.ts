import { expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { TerminalConnection, type TerminalApi, type TerminalSink } from "./terminalConnection";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const info = { id: "pty", shell: "PowerShell", cwd: "C:/repo" };
const req = { cwd: info.cwd, shell: "default" as const, cols: 80, rows: 24 };
function fixture() {
  const read = deferred<Awaited<ReturnType<TerminalApi["terminalRead"]>>>();
  const api = {
    terminalOpen: vi.fn(async () => info),
    terminalRead: vi.fn(() => read.promise),
    terminalWrite: vi.fn(async (_req: Parameters<TerminalApi["terminalWrite"]>[0]) => null),
    terminalResize: vi.fn(async () => null),
    terminalClose: vi.fn(async () => null),
  };
  const sink: TerminalSink = {
    output: vi.fn((_bytes, done) => done()),
    opened: vi.fn(),
    exited: vi.fn(),
    error: vi.fn(),
  };
  return { api, sink, read, connection: new TerminalConnection(sink, api) };
}

it("waits for terminal parsing before reading more and preserves raw UTF-8 chunks", async () => {
  const f = fixture();
  let parsed!: () => void;
  f.sink.output = vi.fn((_bytes, done) => {
    parsed = done;
  });
  f.api.terminalRead.mockResolvedValueOnce({
    data: [228, 184],
    exited: false,
    exitCode: null,
    error: null,
  });
  f.api.terminalRead.mockResolvedValueOnce({ data: [173], exited: true, exitCode: 7, error: null });
  const running = f.connection.start(req);
  await flushPromises();
  expect(f.api.terminalRead).toHaveBeenCalledTimes(1);
  expect(f.sink.output).toHaveBeenLastCalledWith(new Uint8Array([228, 184]), expect.any(Function));
  parsed();
  await flushPromises();
  expect(f.api.terminalRead).toHaveBeenCalledTimes(2);
  expect(f.sink.exited).not.toHaveBeenCalled();
  parsed();
  await running;
  expect(f.sink.output).toHaveBeenLastCalledWith(new Uint8Array([173]), expect.any(Function));
  expect(f.sink.exited).toHaveBeenCalledWith(7);
  expect(f.api.terminalClose).toHaveBeenCalledExactlyOnceWith("pty");
});

it("closes a late opening session after its tab has been removed", async () => {
  const f = fixture();
  const opening = deferred<typeof info>();
  f.api.terminalOpen.mockReturnValueOnce(opening.promise);
  const running = f.connection.start(req);
  await f.connection.close();
  opening.resolve(info);
  await running;
  expect(f.api.terminalClose).toHaveBeenCalledExactlyOnceWith("pty");
  expect(f.sink.opened).not.toHaveBeenCalled();
  expect(f.api.terminalRead).not.toHaveBeenCalled();
});

it("releases a pending output callback on close and ignores late data", async () => {
  const f = fixture();
  f.sink.output = vi.fn();
  f.api.terminalRead.mockResolvedValueOnce({
    data: [1],
    exited: false,
    exitCode: null,
    error: null,
  });
  const running = f.connection.start(req);
  await flushPromises();
  await f.connection.close();
  await running;
  expect(f.api.terminalRead).toHaveBeenCalledTimes(1);
  expect(f.sink.exited).not.toHaveBeenCalled();
  expect(f.api.terminalClose).toHaveBeenCalledTimes(1);
});

it("serializes large Unicode pastes and does not split a surrogate pair", async () => {
  const f = fixture();
  void f.connection.start(req);
  await flushPromises();
  const first = deferred<null>();
  f.api.terminalWrite.mockReturnValueOnce(first.promise);
  const input = "a".repeat(8191) + "😀" + "中".repeat(9000);
  f.connection.write(input);
  f.connection.write("\r");
  await flushPromises();
  expect(f.api.terminalWrite).toHaveBeenCalledTimes(1);
  first.resolve(null);
  await flushPromises();
  const chunks = f.api.terminalWrite.mock.calls.map(([req]) => req.data);
  expect(chunks.join("")).toBe(input + "\r");
  for (const chunk of chunks) {
    expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(65536);
    expect(new TextDecoder().decode(new TextEncoder().encode(chunk))).toBe(chunk);
  }
  await f.connection.close();
  f.read.resolve({ data: [], exited: true, exitCode: null, error: null });
});

it("stops a failed input stream before queued text or Enter can follow a partial write", async () => {
  const f = fixture();
  const running = f.connection.start(req);
  await flushPromises();
  const failed = deferred<null>();
  const closing = deferred<null>();
  f.api.terminalWrite.mockResolvedValueOnce(null).mockReturnValueOnce(failed.promise);
  f.api.terminalClose.mockReturnValueOnce(closing.promise);
  f.connection.write("x".repeat(20000));
  f.connection.write("queued suffix");
  f.connection.write("\r");
  await flushPromises();
  expect(f.api.terminalWrite).toHaveBeenCalledTimes(2);
  const failure = new Error("write failed after a partial prefix");
  failed.reject(failure);
  await flushPromises();
  f.connection.write("later input");
  f.connection.resize(120, 40);
  f.read.resolve({ data: [65], exited: true, exitCode: 7, error: null });
  await flushPromises();
  const writes = f.api.terminalWrite.mock.calls.slice();
  closing.resolve(null);
  await running;
  await f.connection.close();
  expect(writes).toHaveLength(2);
  expect(f.api.terminalWrite).toHaveBeenCalledTimes(2);
  expect(f.api.terminalClose).toHaveBeenCalledExactlyOnceWith("pty");
  expect(f.sink.error).toHaveBeenCalledWith(failure, "input");
  expect(f.sink.exited).toHaveBeenCalledExactlyOnceWith(null);
  expect(f.sink.output).not.toHaveBeenCalled();
  expect(f.api.terminalResize).not.toHaveBeenCalled();
});

it("releases an outstanding output parser when input fails", async () => {
  const f = fixture();
  let parsed!: () => void;
  f.sink.output = vi.fn((_bytes, done) => {
    parsed = done;
  });
  f.api.terminalRead.mockResolvedValueOnce({
    data: [65],
    exited: false,
    exitCode: null,
    error: null,
  });
  const running = f.connection.start(req);
  await flushPromises();
  f.api.terminalWrite.mockRejectedValueOnce(new Error("input unavailable"));
  f.connection.write("one input");
  await flushPromises();
  const ended = vi.fn();
  void running.then(ended);
  await flushPromises();
  const endedBeforeParserReply = ended.mock.calls.length;
  // Settle the old implementation as well, so the negative regression leaves no pending work.
  await f.connection.close();
  await running;
  parsed();
  await flushPromises();
  expect(endedBeforeParserReply).toBe(1);
  expect(f.api.terminalRead).toHaveBeenCalledTimes(1);
  expect(f.api.terminalClose).toHaveBeenCalledExactlyOnceWith("pty");
  expect(f.sink.exited).toHaveBeenCalledExactlyOnceWith(null);
});

it("ignores a late read failure after an input failure has ended the session", async () => {
  const f = fixture();
  const running = f.connection.start(req);
  await flushPromises();
  const failure = new Error("input unavailable");
  f.api.terminalWrite.mockRejectedValueOnce(failure);
  f.connection.write("one input");
  await flushPromises();
  f.read.reject(new Error("read after close"));
  await running;
  expect(f.sink.error).toHaveBeenCalledExactlyOnceWith(failure, "input");
  expect(f.sink.exited).toHaveBeenCalledExactlyOnceWith(null);
  expect(f.api.terminalClose).toHaveBeenCalledExactlyOnceWith("pty");
});

it.each(["close", "exit"])("ignores input failure arriving after %s", async (end) => {
  const f = fixture();
  const running = f.connection.start(req);
  await flushPromises();
  const writing = deferred<null>();
  f.api.terminalWrite.mockReturnValueOnce(writing.promise);
  f.connection.write("pending input");
  f.connection.write("\r");
  await flushPromises();
  if (end === "close") await f.connection.close();
  f.read.resolve({ data: [], exited: true, exitCode: 7, error: null });
  await running;
  writing.reject(new Error("obsolete input failure"));
  await flushPromises();
  expect(f.sink.error).not.toHaveBeenCalled();
  expect(f.api.terminalWrite).toHaveBeenCalledTimes(1);
  expect(f.api.terminalClose).toHaveBeenCalledExactlyOnceWith("pty");
  expect(vi.mocked(f.sink.exited).mock.calls).toEqual(end === "close" ? [] : [[7]]);
});

it("joins input failure cleanup when the tab is closed during release", async () => {
  const f = fixture();
  const running = f.connection.start(req);
  await flushPromises();
  const closing = deferred<null>();
  f.api.terminalClose.mockReturnValueOnce(closing.promise);
  f.api.terminalWrite.mockRejectedValueOnce(new Error("input unavailable"));
  f.connection.write("input");
  await flushPromises();
  const completed = vi.fn();
  const close = f.connection.close().then(completed);
  await flushPromises();
  const completedBeforeRelease = completed.mock.calls.length;
  closing.resolve(null);
  f.read.resolve({ data: [], exited: true, exitCode: null, error: null });
  await Promise.all([running, close]);
  expect(completedBeforeRelease).toBe(0);
  expect(completed).toHaveBeenCalledOnce();
  expect(f.api.terminalClose).toHaveBeenCalledOnce();
});

it("drops queued dimensions and late resize errors when input fails", async () => {
  const f = fixture();
  const running = f.connection.start(req);
  await flushPromises();
  const resizing = deferred<null>();
  f.api.terminalResize.mockReturnValueOnce(resizing.promise);
  f.connection.resize(90, 30);
  f.connection.resize(120, 40);
  f.api.terminalWrite.mockRejectedValueOnce(new Error("input unavailable"));
  f.connection.write("input");
  await flushPromises();
  resizing.reject(new Error("resize after input stopped"));
  f.read.resolve({ data: [], exited: true, exitCode: null, error: null });
  await running;
  await flushPromises();
  expect(f.sink.error).toHaveBeenCalledExactlyOnceWith(new Error("input unavailable"), "input");
  expect(f.api.terminalResize).toHaveBeenCalledOnce();
  expect(f.api.terminalClose).toHaveBeenCalledOnce();
});

it("rejects oversized queued input without ending a healthy terminal", async () => {
  const f = fixture();
  const running = f.connection.start(req);
  await flushPromises();
  f.connection.write("x".repeat(1024 * 1024 + 1));
  f.connection.write("accepted input");
  await flushPromises();
  expect(f.api.terminalWrite).toHaveBeenCalledExactlyOnceWith({
    id: "pty",
    data: "accepted input",
  });
  expect(f.sink.error).toHaveBeenCalledOnce();
  expect(f.sink.exited).not.toHaveBeenCalled();
  expect(f.api.terminalClose).not.toHaveBeenCalled();
  await f.connection.close();
  f.read.resolve({ data: [], exited: true, exitCode: null, error: null });
  await running;
});

it("coalesces resize bursts without allowing an old size to arrive last", async () => {
  const f = fixture();
  void f.connection.start(req);
  await flushPromises();
  const first = deferred<null>();
  f.api.terminalResize.mockReturnValueOnce(first.promise);
  f.connection.resize(90, 30);
  f.connection.resize(100, 35);
  f.connection.resize(120, 40);
  await flushPromises();
  expect(f.api.terminalResize).toHaveBeenCalledTimes(1);
  first.resolve(null);
  await flushPromises();
  expect(f.api.terminalResize).toHaveBeenCalledTimes(2);
  expect(f.api.terminalResize).toHaveBeenLastCalledWith({ id: "pty", cols: 120, rows: 40 });
  await f.connection.close();
  f.read.resolve({ data: [], exited: true, exitCode: null, error: null });
});

it("releases the PTY after a read failure", async () => {
  const f = fixture();
  f.api.terminalRead.mockRejectedValueOnce(new Error("broken IPC"));
  await f.connection.start(req);
  expect(f.sink.error).toHaveBeenCalledOnce();
  expect(f.api.terminalClose).toHaveBeenCalledExactlyOnceWith("pty");
});

it("applies the latest queued size after an older resize fails", async () => {
  const f = fixture();
  const running = f.connection.start(req);
  await flushPromises();
  const first = deferred<null>();
  f.api.terminalResize.mockReturnValueOnce(first.promise);
  f.connection.resize(90, 30);
  f.connection.resize(100, 35);
  f.connection.resize(120, 40);
  await flushPromises();
  expect(f.api.terminalResize).toHaveBeenCalledTimes(1);
  first.reject(new Error("temporary resize failure"));
  await flushPromises();
  await f.connection.close();
  f.read.resolve({ data: [], exited: true, exitCode: null, error: null });
  await running;
  expect(f.api.terminalResize.mock.calls).toEqual([
    [{ id: "pty", cols: 90, rows: 30 }],
    [{ id: "pty", cols: 120, rows: 40 }],
  ]);
  expect(f.sink.error).toHaveBeenCalledExactlyOnceWith(new Error("temporary resize failure"));
});

it("does not retry failed sizes and accepts a later explicit resize", async () => {
  const f = fixture();
  const running = f.connection.start(req);
  await flushPromises();
  const first = deferred<null>();
  f.api.terminalResize
    .mockReturnValueOnce(first.promise)
    .mockRejectedValueOnce(new Error("latest size also failed"));
  f.connection.resize(90, 30);
  f.connection.resize(120, 40);
  first.reject(new Error("first size failed"));
  await flushPromises();
  const failedCalls = f.api.terminalResize.mock.calls.slice();
  await flushPromises();
  expect(f.api.terminalResize.mock.calls).toEqual(failedCalls);
  f.connection.resize(130, 45);
  await flushPromises();
  await f.connection.close();
  f.read.resolve({ data: [], exited: true, exitCode: null, error: null });
  await running;
  expect(failedCalls).toEqual([
    [{ id: "pty", cols: 90, rows: 30 }],
    [{ id: "pty", cols: 120, rows: 40 }],
  ]);
  expect(f.api.terminalResize).toHaveBeenLastCalledWith({ id: "pty", cols: 130, rows: 45 });
  expect(f.sink.error).toHaveBeenCalledTimes(2);
});

it.each(["close", "exit"])("drops queued sizes and late resize errors after %s", async (end) => {
  const f = fixture();
  const running = f.connection.start(req);
  await flushPromises();
  const first = deferred<null>();
  f.api.terminalResize.mockReturnValueOnce(first.promise);
  f.connection.resize(90, 30);
  f.connection.resize(120, 40);
  if (end === "close") await f.connection.close();
  f.read.resolve({ data: [], exited: true, exitCode: 0, error: null });
  await running;
  first.reject(new Error("obsolete resize"));
  await flushPromises();
  expect(f.api.terminalResize).toHaveBeenCalledTimes(1);
  expect(f.sink.error).not.toHaveBeenCalled();
  expect(f.api.terminalClose).toHaveBeenCalledExactlyOnceWith("pty");
});
