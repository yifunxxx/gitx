import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import TerminalView from "./TerminalView.vue";
import { isTerminalToggle } from "./terminalShortcut";

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
beforeEach(() => {
  mocks.terminals.length = mocks.connections.length = 0;
  mocks.workspace = reactive({ repoPath: "C:/first", folderPath: "C:/first" });
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
