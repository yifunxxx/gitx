import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import TerminalView from "./TerminalView.vue";
import { terminalDirectoryRequests } from "./terminalDirectoryRequest";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh-CN.json";

const mocks = vi.hoisted(() => ({
  terminals: [] as any[],
  commands: {
    terminalOpen: vi.fn(),
    terminalRead: vi.fn(),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    terminalClose: vi.fn(),
  },
}));
vi.mock("@/lib/backend/bindings", () => ({ commands: mocks.commands }));
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: () => ({ repoPath: "C:/fixture", navigationToken: () => 0 }),
}));
vi.mock("@/lib/utils", () => ({ isTauri: () => true }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: any;
    cols = 80;
    rows = 24;
    input!: (data: string) => void;
    constructor(options: any) {
      this.options = options;
      mocks.terminals.push(this);
    }
    open() {}
    loadAddon() {}
    focus() {}
    dispose() {}
    attachCustomKeyEventHandler() {}
    hasSelection() {
      return false;
    }
    write(_data: Uint8Array, done: () => void) {
      done();
    }
    onData(callback: (data: string) => void) {
      this.input = callback;
      return { dispose() {} };
    }
  },
}));

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.terminals.length = 0;
  terminalDirectoryRequests.value = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.commands.terminalResize.mockResolvedValue(null);
  mocks.commands.terminalClose.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());

it.each(["en", "zh-CN"])(
  "shows input failure and permits a fresh terminal in %s",
  async (locale) => {
    let failWrite!: (error: Error) => void;
    const reads = new Map<
      string,
      { resolve: (value: any) => void; reject: (error: Error) => void }
    >();
    mocks.commands.terminalOpen
      .mockResolvedValueOnce({ id: "first", cwd: "C:/fixture", shell: "Shell" })
      .mockResolvedValueOnce({ id: "second", cwd: "C:/fixture", shell: "Shell" });
    mocks.commands.terminalRead.mockImplementation(
      (id: string) =>
        new Promise((resolve, reject) => {
          reads.set(id, { resolve, reject });
        }),
    );
    mocks.commands.terminalWrite.mockImplementationOnce(
      () =>
        new Promise<null>((_resolve, reject) => {
          failWrite = reject;
        }),
    );
    const messages = { en, "zh-CN": zh };
    const strings = messages[locale as keyof typeof messages].terminal;
    const wrapper = mount(TerminalView, {
      props: { visible: true },
      attachTo: document.body,
      global: { plugins: [createI18n({ legacy: false, locale, messages })] },
    });
    await flushPromises();
    mocks.terminals[0].input("prefix");
    mocks.terminals[0].input("\r");
    await flushPromises();
    failWrite(new Error("write unavailable"));
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      strings.inputFailed.replace("{error}", "write unavailable"),
    );
    expect(mocks.terminals[0].options.disableStdin).toBe(true);
    expect(wrapper.get(`[aria-label="${strings.paste}"]`).attributes("disabled")).toBeDefined();
    expect(mocks.commands.terminalWrite).toHaveBeenCalledExactlyOnceWith({
      id: "first",
      data: "prefix",
    });
    expect(mocks.commands.terminalClose).toHaveBeenCalledExactlyOnceWith("first");
    await wrapper.get(`[aria-label="${strings.new}"]`).trigger("click");
    await flushPromises();
    reads.get("first")!.reject(new Error("late read failure"));
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(mocks.terminals[1].options.disableStdin).toBe(false);
    expect(wrapper.get(`[aria-label="${strings.paste}"]`).attributes("disabled")).toBeUndefined();
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2);
    wrapper.unmount();
    reads.get("second")!.resolve({ data: [], exited: true, exitCode: 0, error: null });
    await flushPromises();
    expect(mocks.commands.terminalClose.mock.calls).toEqual([["first"], ["second"]]);
  },
);
