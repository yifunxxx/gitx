import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import TerminalView from "./TerminalView.vue";
import { isTerminalToggle } from "./terminalShortcut";
import { requestTerminalDirectory, terminalDirectoryRequests } from "./terminalDirectoryRequest";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  terminals: [] as any[],
  connections: [] as any[],
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/lib/utils", () => ({ isTauri: () => true }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: any;
    cols = 80;
    rows = 24;
    focus = vi.fn();
    dispose = vi.fn();
    clear = vi.fn();
    paste = vi.fn();
    handler: any;
    input: any;
    constructor(options: any) {
      this.options = options;
      mocks.terminals.push(this);
    }
    loadAddon() {}
    open() {}
    hasSelection() {
      return true;
    }
    getSelection() {
      return "selected text";
    }
    onData(callback: any) {
      this.input = callback;
      return { dispose: vi.fn() };
    }
    attachCustomKeyEventHandler(callback: any) {
      this.handler = callback;
    }
    write(_bytes: Uint8Array, done: () => void) {
      done();
    }
  },
}));
vi.mock("./terminalConnection", () => ({
  TerminalConnection: class {
    sink: any;
    start = vi.fn();
    write = vi.fn();
    resize = vi.fn();
    close = vi.fn(async () => true);
    constructor(sink: any) {
      this.sink = sink;
      mocks.connections.push(this);
    }
  },
}));

enableAutoUnmount(afterEach);
it("refreshes terminal colors when the material changes without a dark/light change", async () => {
  mount(TerminalView, { props: { visible: true }, attachTo: document.body });
  await flushPromises();
  const terminal = mocks.terminals[0];
  const original = terminal.options.theme;
  document.documentElement.dataset.theme = "liquid-glass";
  await flushPromises();
  expect(terminal.options.theme).not.toBe(original);
  delete document.documentElement.dataset.theme;
  await flushPromises();
});
beforeEach(() => {
  terminalDirectoryRequests.value = [];
  mocks.terminals.length = mocks.connections.length = 0;
  mocks.workspace = reactive({
    repoPath: "C:/first",
    folderPath: "C:/first",
    openGeneration: 0,
    navigationToken: () => mocks.workspace.openGeneration,
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      readText: vi.fn(async () => "paste me"),
      writeText: vi.fn(async () => {}),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it("consumes a directory request on lazy mount without opening an extra root terminal", async () => {
  requestTerminalDirectory("C:/first/src/O'Brien & $x", () => true);
  mount(TerminalView, { props: { visible: true } });
  await flushPromises();
  expect(mocks.connections).toHaveLength(1);
  expect(mocks.connections[0].start).toHaveBeenCalledWith(
    expect.objectContaining({ cwd: "C:/first/src/O'Brien & $x" }),
  );
  expect(mocks.connections[0].write).not.toHaveBeenCalled();
  expect(terminalDirectoryRequests.value).toHaveLength(0);
});

it("opens fresh sessions for repeated requests without changing existing shells", async () => {
  const wrapper = mount(TerminalView, { props: { visible: true } });
  await flushPromises();
  await wrapper.setProps({ visible: false });
  requestTerminalDirectory("C:/first/src", () => true);
  requestTerminalDirectory("C:/first/src", () => true);
  await flushPromises();
  expect(mocks.connections).toHaveLength(1);
  await wrapper.setProps({ visible: true });
  await flushPromises();
  expect(mocks.connections).toHaveLength(3);
  expect(mocks.connections[1].start).toHaveBeenCalledWith(
    expect.objectContaining({ cwd: "C:/first/src" }),
  );
  expect(mocks.connections[2].start).toHaveBeenCalledWith(
    expect.objectContaining({ cwd: "C:/first/src" }),
  );
  expect(mocks.connections[0].write).not.toHaveBeenCalled();
  expect(mocks.connections[0].close).not.toHaveBeenCalled();
});

it("discards requests invalidated before the terminal is mounted", async () => {
  let current = true;
  requestTerminalDirectory("C:/first/stale", () => current);
  current = false;
  mount(TerminalView, { props: { visible: true } });
  await flushPromises();
  expect(
    mocks.connections.every((connection) =>
      connection.start.mock.calls.every(([req]: any[]) => req.cwd !== "C:/first/stale"),
    ),
  ).toBe(true);
  expect(terminalDirectoryRequests.value).toHaveLength(0);
});

it("cancels a requested session if navigation changes while its terminal is activating", async () => {
  const current = vi
    .fn()
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(true)
    .mockReturnValue(false);
  requestTerminalDirectory("C:/first/stale", current);
  mount(TerminalView, { props: { visible: true } });
  await flushPromises();
  expect(mocks.connections[0].start).not.toHaveBeenCalled();
  expect(mocks.connections[0].close).toHaveBeenCalledOnce();
  expect(mocks.terminals[0].dispose).toHaveBeenCalledOnce();
});

it("reports the session limit and consumes requests without writing shell commands", async () => {
  const wrapper = mount(TerminalView, { props: { visible: true } });
  await flushPromises();
  for (let index = 0; index < 16; index++)
    requestTerminalDirectory(`C:/first/${index}`, () => true);
  await flushPromises();
  expect(mocks.connections).toHaveLength(16);
  expect(wrapper.get('[role="alert"]').text()).toBe("terminal.sessionLimit");
  expect(terminalDirectoryRequests.value).toHaveLength(0);
  expect(mocks.connections.every((connection) => !connection.write.mock.calls.length)).toBe(true);
});

it("offers terminal context actions and restores focus on Escape", async () => {
  const wrapper = mount(TerminalView, { props: { visible: true }, attachTo: document.body });
  await flushPromises();
  await wrapper.get("[data-terminal-host]").trigger("contextmenu", { clientX: 40, clientY: 60 });
  await flushPromises();
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain("terminal.copy");
  expect(menu.textContent).toContain("terminal.selectAll");
  menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flushPromises();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(mocks.terminals[0].focus).toHaveBeenCalled();
});

it("updates ready and exit controls without needing another UI interaction", async () => {
  const wrapper = mount(TerminalView, { props: { visible: true } });
  await flushPromises();
  expect(mocks.connections).toHaveLength(1);
  const paste = wrapper.get('[aria-label="terminal.paste"]');
  expect(paste.attributes("disabled")).toBeDefined();
  mocks.connections[0].sink.opened({ shell: "PowerShell", cwd: "C:/first", id: "one" });
  await flushPromises();
  expect(paste.attributes("disabled")).toBeUndefined();
  expect(wrapper.get('[role="tab"]').text()).not.toContain("…");
  await paste.trigger("click");
  expect(mocks.terminals[0].paste).toHaveBeenCalledWith("paste me");
  mocks.connections[0].sink.exited(7);
  await flushPromises();
  expect(wrapper.get('[role="tab"]').text()).toContain("terminal.exited");
  expect(paste.attributes("disabled")).toBeDefined();
  expect(mocks.terminals[0].options.disableStdin).toBe(true);
});

function delayedClipboard() {
  let resolve!: (text: string) => void;
  let reject!: (reason: unknown) => void;
  vi.mocked(navigator.clipboard.readText).mockReturnValueOnce(
    new Promise<string>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
  );
  return { resolve, reject };
}

async function runningTerminal() {
  const wrapper = mount(TerminalView, { props: { visible: true }, attachTo: document.body });
  await flushPromises();
  mocks.connections[0].sink.opened({ shell: "PowerShell", cwd: "C:/first", id: "one" });
  await flushPromises();
  return wrapper;
}

it.each([undefined, "input"] as const)(
  "keeps background transport errors on their source terminal: %s",
  async (source) => {
    const wrapper = await runningTerminal();
    await wrapper.get('[aria-label="terminal.new"]').trigger("click");
    await flushPromises();
    mocks.terminals[1].focus.mockClear();
    mocks.connections[0].sink.error(new Error("first transport failed"), source);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(mocks.terminals[1].focus).not.toHaveBeenCalled();
    expect(wrapper.findAll('[role="tab"]')[0]!.find("[data-terminal-error]").exists()).toBe(true);
    expect(wrapper.findAll('[role="tab"]')[1]!.find("[data-terminal-error]").exists()).toBe(false);
    await wrapper.findAll('[role="tab"]')[0]!.trigger("click");
    expect(wrapper.get('[role="alert"]').text()).toContain(
      source === "input" ? "terminal.inputFailed" : "first transport failed",
    );
  },
);

it("retains a failed start's reason after another session is created", async () => {
  const wrapper = mount(TerminalView, { props: { visible: true } });
  await flushPromises();
  mocks.connections[0].sink.error(new Error("shell executable missing"));
  await flushPromises();
  expect(wrapper.get('[role="tab"]').text()).toContain("terminal.failed");
  await wrapper.get('[aria-label="terminal.new"]').trigger("click");
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  await wrapper.findAll('[role="tab"]')[0]!.trigger("click");
  expect(wrapper.get('[role="alert"]').text()).toContain("shell executable missing");
});

it("does not carry a removed session's error into the remaining terminal", async () => {
  const wrapper = await runningTerminal();
  await wrapper.get('[aria-label="terminal.new"]').trigger("click");
  await flushPromises();
  await wrapper.findAll('[role="tab"]')[0]!.trigger("click");
  mocks.connections[0].sink.error(new Error("first read failed"));
  await flushPromises();
  await wrapper.get('[aria-label="terminal.close"]').trigger("click");
  await flushPromises();
  expect(wrapper.findAll('[role="tab"]')).toHaveLength(1);
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
});

it("keeps transport feedback when clipboard access is retried successfully", async () => {
  const wrapper = await runningTerminal();
  mocks.connections[0].sink.error(new Error("resize unavailable"));
  vi.mocked(navigator.clipboard.readText).mockRejectedValueOnce(new Error("clipboard unavailable"));
  await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
  await flushPromises();
  await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
  await flushPromises();
  expect(mocks.terminals[0].paste).toHaveBeenCalledExactlyOnceWith("paste me");
  expect(wrapper.get('[role="alert"]').text()).toContain("resize unavailable");
  expect(wrapper.text()).not.toContain("clipboard unavailable");
});

it.each(["switch", "close", "unmount"])(
  "keeps a delayed copy failure scoped after %s",
  async (change) => {
    const wrapper = await runningTerminal();
    let reject!: (error: Error) => void;
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(
      new Promise<void>((_resolve, no) => {
        reject = no;
      }),
    );
    await wrapper.get('[aria-label="terminal.copy"]').trigger("click");
    if (change === "close") {
      await wrapper.get('[aria-label="terminal.close"]').trigger("click");
      await flushPromises();
    }
    if (change === "unmount") wrapper.unmount();
    else {
      await wrapper.get('[aria-label="terminal.new"]').trigger("click");
      await flushPromises();
    }
    reject(new Error("first copy denied"));
    await flushPromises();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    if (change === "switch") {
      await wrapper.findAll('[role="tab"]')[0]!.trigger("click");
      expect(wrapper.get('[role="alert"]').text()).toContain("first copy denied");
    }
  },
);

it("ignores an older copy failure after a newer copy succeeds", async () => {
  const wrapper = await runningTerminal();
  let reject!: (error: Error) => void;
  vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(
    new Promise<void>((_resolve, no) => {
      reject = no;
    }),
  );
  await wrapper.get('[aria-label="terminal.copy"]').trigger("click");
  await wrapper.get('[aria-label="terminal.copy"]').trigger("click");
  await flushPromises();
  reject(new Error("obsolete copy failure"));
  await flushPromises();
  expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2);
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
});

it("clears a copy error on retry without clearing the transport error", async () => {
  const wrapper = await runningTerminal();
  mocks.connections[0].sink.error(new Error("resize unavailable"));
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("copy denied"));
  await wrapper.get('[aria-label="terminal.copy"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("copy denied");
  await wrapper.get('[aria-label="terminal.copy"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("resize unavailable");
  expect(wrapper.text()).not.toContain("copy denied");
});

it("ignores obsolete copy feedback after a paste succeeds", async () => {
  const wrapper = await runningTerminal();
  let reject!: (error: Error) => void;
  vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(
    new Promise<void>((_resolve, no) => {
      reject = no;
    }),
  );
  await wrapper.get('[aria-label="terminal.copy"]').trigger("click");
  await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
  await flushPromises();
  reject(new Error("old copy denied"));
  await flushPromises();
  expect(mocks.terminals[0].paste).toHaveBeenCalledExactlyOnceWith("paste me");
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
});

it("cancels a pending paste when a new copy action replaces it", async () => {
  const wrapper = await runningTerminal();
  const pending = delayedClipboard();
  await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
  await wrapper.get('[aria-label="terminal.copy"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('[aria-label="terminal.paste"]').attributes("aria-busy")).toBe("false");
  pending.resolve("old clipboard text");
  await flushPromises();
  expect(mocks.terminals[0].paste).not.toHaveBeenCalled();
});

it("ignores transport feedback from a removed terminal", async () => {
  const wrapper = await runningTerminal();
  await wrapper.get('[aria-label="terminal.close"]').trigger("click");
  await flushPromises();
  await wrapper.get('[aria-label="terminal.new"]').trigger("click");
  await flushPromises();
  mocks.connections[0].sink.error(new Error("obsolete read failure"));
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.find("[data-terminal-error]").exists()).toBe(false);
});

it("keeps a terminal visible and input disabled until close is confirmed", async () => {
  const wrapper = await runningTerminal();
  let finish!: (value: boolean) => void;
  mocks.connections[0].close.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      finish = resolve;
    }),
  );
  await wrapper.get('[aria-label="terminal.close"]').trigger("click");
  const tabStillPresent = wrapper.findAll('[role="tab"]').length;
  const disposedBeforeClose = mocks.terminals[0].dispose.mock.calls.length;
  const inputDisabled = mocks.terminals[0].options.disableStdin;
  const closeDisabled = wrapper.get('[aria-label="terminal.close"]').attributes("disabled");
  finish(true);
  await flushPromises();
  expect(tabStillPresent).toBe(1);
  expect(disposedBeforeClose).toBe(0);
  expect(inputDisabled).toBe(true);
  expect(closeDisabled).toBeDefined();
  expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
  expect(mocks.terminals[0].dispose).toHaveBeenCalledOnce();
});

it("keeps a failed close attached to its original session and lets the user retry", async () => {
  const wrapper = await runningTerminal();
  mocks.connections[0].close.mockImplementationOnce(async () => {
    mocks.connections[0].sink.error(new Error("cannot close first"), "close");
    return false;
  });
  await wrapper.get('[aria-label="terminal.close"]').trigger("click");
  await flushPromises();
  expect(wrapper.findAll('[role="tab"]')).toHaveLength(1);
  expect(wrapper.get('[role="tab"]').text()).toContain("terminal.closeFailed");
  expect(mocks.terminals[0].dispose).not.toHaveBeenCalled();
  expect(wrapper.get('[aria-label="terminal.close"]').attributes("disabled")).toBeUndefined();
  await wrapper.get('[aria-label="terminal.new"]').trigger("click");
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  await wrapper.findAll('[role="tab"]')[0]!.trigger("click");
  expect(wrapper.get('[role="alert"]').text()).toBe("terminal.closeFailedDetail");
  await wrapper.get('[aria-label="terminal.close"]').trigger("click");
  await flushPromises();
  expect(mocks.connections[0].close).toHaveBeenCalledTimes(2);
  expect(wrapper.findAll('[role="tab"]')).toHaveLength(1);
  expect(mocks.terminals[0].dispose).toHaveBeenCalledOnce();
});

it("does not select another tab when a background terminal finishes closing", async () => {
  const wrapper = await runningTerminal();
  let finish!: (value: boolean) => void;
  mocks.connections[0].close.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      finish = resolve;
    }),
  );
  await wrapper.get('[aria-label="terminal.close"]').trigger("click");
  await wrapper.get('[aria-label="terminal.new"]').trigger("click");
  await flushPromises();
  mocks.terminals[1].focus.mockClear();
  finish(true);
  await flushPromises();
  expect(wrapper.findAll('[role="tab"]')).toHaveLength(1);
  expect(wrapper.get('[role="tab"]').text()).toContain("2:");
  expect(mocks.terminals[1].focus).not.toHaveBeenCalled();
});

it("releases the renderer on unmount even if a close is still waiting", async () => {
  const wrapper = await runningTerminal();
  let finish!: (value: boolean) => void;
  const closing = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  mocks.connections[0].close.mockReturnValue(closing);
  await wrapper.get('[aria-label="terminal.close"]').trigger("click");
  wrapper.unmount();
  expect(mocks.terminals[0].dispose).toHaveBeenCalledOnce();
  mocks.connections[0].sink.error(new Error("late close failure"), "close");
  finish(false);
  await flushPromises();
  expect(mocks.terminals[0].dispose).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("invalidates a clipboard request as soon as close begins", async () => {
  const wrapper = await runningTerminal();
  const clipboard = delayedClipboard();
  await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
  let finish!: (value: boolean) => void;
  mocks.connections[0].close.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      finish = resolve;
    }),
  );
  await wrapper.get('[aria-label="terminal.close"]').trigger("click");
  clipboard.resolve("must not paste");
  await flushPromises();
  expect(mocks.terminals[0].paste).not.toHaveBeenCalled();
  expect(wrapper.get('[aria-label="terminal.paste"]').attributes("aria-busy")).toBe("false");
  expect(wrapper.get('[aria-label="terminal.paste"]').attributes("disabled")).toBeDefined();
  finish(true);
  await flushPromises();
});

it.each([
  { key: "c", ctrlKey: true },
  { key: "C", ctrlKey: true, shiftKey: true },
  { key: "C", metaKey: true, shiftKey: true },
])("copies selected terminal text when native input omits code: %j", async (init) => {
  await runningTerminal();
  const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
  expect(mocks.terminals[0].handler(event)).toBe(false);
  await flushPromises();
  expect(event.defaultPrevented).toBe(true);
  expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith("selected text");
});

it.each(["ctrlKey", "metaKey"])("pastes once without code using %s", async (modifier) => {
  await runningTerminal();
  const event = new KeyboardEvent("keydown", {
    key: "V",
    shiftKey: true,
    [modifier]: true,
    cancelable: true,
  });
  expect(mocks.terminals[0].handler(event)).toBe(false);
  await flushPromises();
  expect(event.defaultPrevented).toBe(true);
  expect(mocks.terminals[0].paste).toHaveBeenCalledExactlyOnceWith("paste me");
});

it.each(["alt", "composition229", "consumed", "repeat"])(
  "does not copy or paste for %s keyboard events",
  async (boundary) => {
    await runningTerminal();
    for (const code of ["KeyC", "KeyV"]) {
      const event = new KeyboardEvent("keydown", {
        key: code.slice(-1),
        code,
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
        altKey: boundary === "alt",
        repeat: boundary === "repeat",
      });
      if (boundary === "composition229") Object.defineProperty(event, "keyCode", { value: 229 });
      if (boundary === "consumed") event.preventDefault();
      mocks.terminals[0].handler(event);
      await flushPromises();
    }
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(navigator.clipboard.readText).not.toHaveBeenCalled();
    expect(mocks.terminals[0].paste).not.toHaveBeenCalled();
  },
);

it.each([
  { key: "F10", shiftKey: true, ctrlKey: true },
  { key: "F10", shiftKey: true, altKey: true },
  { key: "ContextMenu", shiftKey: true },
  { key: "ContextMenu", metaKey: true },
  { key: "ContextMenu", repeat: true },
  { key: "F10", shiftKey: true, keyCode: 229 },
])("does not open a terminal menu for unrelated input: %j", async (init) => {
  await runningTerminal();
  const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
  if (init.keyCode) Object.defineProperty(event, "keyCode", { value: init.keyCode });
  mocks.terminals[0].handler(event);
  await flushPromises();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it.each(["ctrlKey", "altKey", "metaKey", "shiftKey", "composition229", "consumed"])(
  "does not switch terminal tabs for %s navigation",
  async (boundary) => {
    const wrapper = await runningTerminal();
    await wrapper.get('[aria-label="terminal.new"]').trigger("click");
    await flushPromises();
    const second = wrapper.findAll('[role="tab"]')[1]!;
    const event = new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      bubbles: true,
      cancelable: true,
      [boundary]: true,
    });
    if (boundary === "composition229") Object.defineProperty(event, "keyCode", { value: 229 });
    if (boundary === "consumed") event.preventDefault();
    second.element.dispatchEvent(event);
    await flushPromises();
    expect(second.attributes("aria-selected")).toBe("true");
  },
);

it("keeps physical key identity and passes unselected Ctrl+C to the terminal", async () => {
  await runningTerminal();
  const terminal = mocks.terminals[0];
  const mismatch = new KeyboardEvent("keydown", {
    key: "V",
    code: "KeyX",
    ctrlKey: true,
    shiftKey: true,
  });
  expect(terminal.handler(mismatch)).toBe(true);
  terminal.hasSelection = () => false;
  expect(terminal.handler(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))).toBe(true);
  expect(navigator.clipboard.readText).not.toHaveBeenCalled();
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
});

it.each([{ key: "ContextMenu" }, { key: "F10", shiftKey: true }])(
  "opens the terminal context menu for its exact shortcut: %j",
  async (init) => {
    await runningTerminal();
    const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
    expect(mocks.terminals[0].handler(event)).toBe(false);
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  },
);

it("keeps plain and repeated terminal tab navigation working", async () => {
  const wrapper = await runningTerminal();
  await wrapper.get('[aria-label="terminal.new"]').trigger("click");
  await flushPromises();
  const tabs = wrapper.findAll('[role="tab"]');
  for (const [from, key, to] of [
    [1, "ArrowLeft", 0],
    [0, "ArrowRight", 1],
    [1, "Home", 0],
    [0, "End", 1],
  ] as const) {
    await tabs[from]!.trigger("keydown", { key, repeat: true });
    expect(tabs[to]!.attributes("aria-selected")).toBe("true");
  }
});

it("keeps one code-less paste pending across repeats without sending a second copy", async () => {
  await runningTerminal();
  const pending = delayedClipboard();
  const handler = mocks.terminals[0].handler;
  for (const repeat of [false, true, true]) {
    expect(
      handler(
        new KeyboardEvent("keydown", {
          key: "V",
          ctrlKey: true,
          shiftKey: true,
          repeat,
          cancelable: true,
        }),
      ),
    ).toBe(false);
    await flushPromises();
  }
  expect(navigator.clipboard.readText).toHaveBeenCalledOnce();
  pending.resolve("one paste");
  await flushPromises();
  expect(mocks.terminals[0].paste).toHaveBeenCalledExactlyOnceWith("one paste");
  handler(
    new KeyboardEvent("keydown", {
      key: "V",
      ctrlKey: true,
      shiftKey: true,
      repeat: true,
      cancelable: true,
    }),
  );
  await flushPromises();
  expect(navigator.clipboard.readText).toHaveBeenCalledOnce();
});

it.each(["isComposing", "keyCode"])(
  "invalidates a pending paste when %s marks a matching shortcut as IME input",
  async (flag) => {
    const wrapper = await runningTerminal();
    const pending = delayedClipboard();
    await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
    const event = new KeyboardEvent("keydown", {
      key: "V",
      code: "KeyV",
      ctrlKey: true,
      shiftKey: true,
      isComposing: flag === "isComposing",
    });
    if (flag === "keyCode") Object.defineProperty(event, "keyCode", { value: 229 });
    expect(mocks.terminals[0].handler(event)).toBe(true);
    pending.resolve("obsolete before composition");
    await flushPromises();
    expect(mocks.terminals[0].paste).not.toHaveBeenCalled();
  },
);

it.each(["switch", "switch-back", "hide", "hide-show", "navigate", "reopen"])(
  "discards pending terminal paste after %s instead of sending it to a stale context",
  async (change) => {
    const wrapper = await runningTerminal();
    const pending = delayedClipboard();
    await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
    if (change.startsWith("switch")) {
      await wrapper.get('[aria-label="terminal.new"]').trigger("click");
      await flushPromises();
      if (change === "switch-back") await wrapper.findAll('[role="tab"]')[0]!.trigger("click");
    } else if (change.startsWith("hide")) {
      await wrapper.setProps({ visible: false });
      if (change === "hide-show") await wrapper.setProps({ visible: true });
    } else if (change === "navigate") mocks.workspace.repoPath = "D:/second";
    else mocks.workspace.openGeneration = 1;
    await flushPromises();
    mocks.terminals[0].focus.mockClear();
    pending.resolve("delayed input\r");
    await flushPromises();
    expect(mocks.terminals[0].paste).not.toHaveBeenCalled();
    expect(mocks.terminals[0].focus).not.toHaveBeenCalled();
    expect(mocks.connections[0].close).not.toHaveBeenCalled();
  },
);

it("allows only one clipboard read until the pending paste completes", async () => {
  const wrapper = await runningTerminal();
  const pending = delayedClipboard();
  const paste = wrapper.get('[aria-label="terminal.paste"]');
  await paste.trigger("click");
  expect(paste.attributes("disabled")).toBeDefined();
  mocks.terminals[0].handler(
    new KeyboardEvent("keydown", {
      key: "V",
      code: "KeyV",
      ctrlKey: true,
      shiftKey: true,
    }),
  );
  await flushPromises();
  expect(navigator.clipboard.readText).toHaveBeenCalledTimes(1);
  pending.resolve("once");
  await flushPromises();
  expect(mocks.terminals[0].paste).toHaveBeenCalledExactlyOnceWith("once");
  expect(paste.attributes("disabled")).toBeUndefined();
});

it.each(["typing", "composition", "native-paste"])(
  "does not append delayed clipboard text after intervening %s",
  async (input) => {
    const wrapper = await runningTerminal();
    const pending = delayedClipboard();
    await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
    if (input === "typing")
      mocks.terminals[0].handler(new KeyboardEvent("keydown", { key: "x", code: "KeyX" }));
    else
      await wrapper
        .get("[data-terminal-host]")
        .trigger(input === "composition" ? "compositionstart" : "paste");
    pending.resolve("old clipboard");
    await flushPromises();
    expect(mocks.terminals[0].paste).not.toHaveBeenCalled();
  },
);

it("ignores a stale clipboard failure after changing terminal context", async () => {
  const wrapper = await runningTerminal();
  const pending = delayedClipboard();
  await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
  await wrapper.setProps({ visible: false });
  pending.reject(new Error("old permission denial"));
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
});

it("keeps a newer paste busy when an invalidated clipboard read settles", async () => {
  const wrapper = await runningTerminal();
  const old = delayedClipboard();
  await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
  await wrapper.setProps({ visible: false });
  await wrapper.setProps({ visible: true });
  const current = delayedClipboard();
  await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
  old.resolve("stale");
  await flushPromises();
  expect(wrapper.get('[aria-label="terminal.paste"]').attributes("aria-busy")).toBe("true");
  expect(mocks.terminals[0].paste).not.toHaveBeenCalled();
  current.resolve("new");
  await flushPromises();
  expect(mocks.terminals[0].paste).toHaveBeenCalledExactlyOnceWith("new");
  expect(wrapper.get('[aria-label="terminal.paste"]').attributes("aria-busy")).toBe("false");
});

it("reports a current clipboard failure, clears waiting state and allows retry", async () => {
  const wrapper = await runningTerminal();
  const pending = delayedClipboard();
  await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
  pending.reject(new Error("clipboard unavailable"));
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("clipboard unavailable");
  const paste = wrapper.get('[aria-label="terminal.paste"]');
  expect(paste.attributes("disabled")).toBeUndefined();
  await paste.trigger("click");
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(mocks.terminals[0].paste).toHaveBeenCalledExactlyOnceWith("paste me");
});

it.each(["close", "unmount", "exit", "external-focus"])(
  "does not paste or steal focus after %s while reading the clipboard",
  async (change) => {
    const wrapper = await runningTerminal();
    const pending = delayedClipboard();
    await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
    const otherInput = document.createElement("input");
    document.body.append(otherInput);
    try {
      if (change === "close") await wrapper.get('[aria-label="terminal.close"]').trigger("click");
      if (change === "unmount") wrapper.unmount();
      if (change === "exit") mocks.connections[0].sink.exited(0);
      if (change === "external-focus") otherInput.focus();
      await flushPromises();
      mocks.terminals[0].focus.mockClear();
      pending.resolve("obsolete");
      await flushPromises();
      expect(mocks.terminals[0].paste).not.toHaveBeenCalled();
      expect(mocks.terminals[0].focus).not.toHaveBeenCalled();
      if (change === "external-focus") expect(document.activeElement).toBe(otherInput);
    } finally {
      otherInput.remove();
    }
  },
);

it("does not cancel clipboard input when the terminal sends a parser reply", async () => {
  const wrapper = await runningTerminal();
  const pending = delayedClipboard();
  await wrapper.get('[aria-label="terminal.paste"]').trigger("click");
  mocks.terminals[0].input("\x1b[1;1R");
  pending.resolve("paste after output");
  await flushPromises();
  expect(mocks.connections[0].write).toHaveBeenCalledWith("\x1b[1;1R");
  expect(mocks.terminals[0].paste).toHaveBeenCalledExactlyOnceWith("paste after output");
});

it("dismisses a terminal menu when a directory request selects a new session", async () => {
  const wrapper = await runningTerminal();
  await wrapper.get("[data-terminal-host]").trigger("contextmenu", { clientX: 40, clientY: 60 });
  await flushPromises();
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  requestTerminalDirectory("C:/first/src", () => true);
  await flushPromises();
  expect(mocks.connections).toHaveLength(2);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("retains sessions while hidden and starts a new session in the newly selected repository", async () => {
  const wrapper = mount(TerminalView, { props: { visible: true } });
  await flushPromises();
  await wrapper.setProps({ visible: false });
  mocks.workspace.repoPath = "D:/second";
  await wrapper.setProps({ visible: true });
  await flushPromises();
  expect(mocks.connections).toHaveLength(1);
  expect(mocks.connections[0].close).not.toHaveBeenCalled();
  await wrapper.get('[aria-label="terminal.new"]').trigger("click");
  await flushPromises();
  expect(mocks.connections[1].start).toHaveBeenCalledWith(
    expect.objectContaining({ cwd: "D:/second" }),
  );
  await wrapper.findAll('[role="tab"]')[0]!.trigger("click");
  expect(wrapper.get('[role="tab"]').attributes("title")).toBe("C:/first");
  await wrapper.get('[aria-label="terminal.close"]').trigger("click");
  expect(mocks.connections[0].close).toHaveBeenCalledOnce();
  expect(mocks.terminals[0].dispose).toHaveBeenCalledOnce();
  expect(wrapper.findAll('[role="tab"]')).toHaveLength(1);
  wrapper.unmount();
  expect(mocks.connections[1].close).toHaveBeenCalledOnce();
  expect(mocks.terminals[1].dispose).toHaveBeenCalledOnce();
});

it.each([
  { code: "Backquote", ctrlKey: true },
  { key: "`", ctrlKey: true },
])("keeps shell shortcuts scoped and propagates the panel toggle %j", async (toggle) => {
  const wrapper = mount(TerminalView, { props: { visible: true }, attachTo: document.body });
  await flushPromises();
  const globalKey = vi.fn();
  window.addEventListener("keydown", globalKey);
  try {
    await wrapper.trigger("keydown", { key: "a", ctrlKey: true, shiftKey: true });
    expect(globalKey).not.toHaveBeenCalled();
    await wrapper.trigger("keydown", toggle);
    expect(globalKey).toHaveBeenCalledOnce();
    expect(
      isTerminalToggle(
        new KeyboardEvent("keydown", { code: "Backquote", ctrlKey: true, isComposing: true }),
      ),
    ).toBe(false);
    const handler = mocks.terminals[0].handler;
    expect(handler(new KeyboardEvent("keydown", toggle))).toBe(false);
    expect(handler(new KeyboardEvent("keydown", { code: "KeyC", ctrlKey: true }))).toBe(false);
    await flushPromises();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("selected text");
    mocks.terminals[0].hasSelection = () => false;
    expect(handler(new KeyboardEvent("keydown", { code: "KeyC", ctrlKey: true }))).toBe(true);
  } finally {
    window.removeEventListener("keydown", globalKey);
  }
});
