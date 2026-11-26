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
  f.api.terminalResize.mockReturnValueOnce(first.promise)
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
