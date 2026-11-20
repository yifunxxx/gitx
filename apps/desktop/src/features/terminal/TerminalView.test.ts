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
    close = vi.fn(async () => {});
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
    repoPath: "C:/first", folderPath: "C:/first", openGeneration: 0,
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
  vi.mocked(navigator.clipboard.readText).mockReturnValueOnce(new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  }));
  return { resolve, reject };
}

async function runningTerminal() {
  const wrapper = mount(TerminalView, { props: { visible: true }, attachTo: document.body });
  await flushPromises();
  mocks.connections[0].sink.opened({ shell: "PowerShell", cwd: "C:/first", id: "one" });
  await flushPromises();
  return wrapper;
}

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
  mocks.terminals[0].handler(new KeyboardEvent("keydown", {
    key: "V", code: "KeyV", ctrlKey: true, shiftKey: true,
  }));
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
    if (input === "typing") mocks.terminals[0].handler(new KeyboardEvent("keydown", { key: "x", code: "KeyX" }));
    else await wrapper.get('[data-terminal-host]').trigger(input === "composition" ? "compositionstart" : "paste");
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
    } finally { otherInput.remove(); }
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
  await wrapper.get('[data-terminal-host]').trigger("contextmenu", { clientX: 40, clientY: 60 });
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
