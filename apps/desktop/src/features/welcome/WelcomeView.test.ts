import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, reactive } from "vue";
import WelcomeView from "./WelcomeView.vue";
import TitleBar from "@/components/layout/TitleBar.vue";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  layout: {} as any,
  open: vi.fn(),
  init: vi.fn(),
  refresh: vi.fn(),
  log: vi.fn(),
  branches: vi.fn(),
  pick: vi.fn(),
  toast: vi.fn(),
  action: vi.fn(),
  choose: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => ({ load: mocks.log }) }));
vi.mock("@/stores/jobsStore", () => ({
  useJobsStore: () => ({ begin: vi.fn(() => "initial-reads"), finished: vi.fn() }),
}));
vi.mock("@/stores/branchesStore", () => ({
  useBranchesStore: () => ({ refresh: mocks.branches }),
}));
vi.mock("@/lib/utils", async (original) => ({
  ...(await original<object>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.pick }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/composables/useOpenProjectChoice", () => ({
  chooseOpenProjectTarget: mocks.choose,
}));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({ settings: { appearance: { theme: "light" } } }),
}));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => ({}) }));
vi.mock("@/stores/updateStore", () => ({ useUpdateStore: () => ({}) }));
vi.mock("@/actions", () => ({ runAction: mocks.action }));
enableAutoUnmount(afterEach);
afterEach(() => {
  document.body.innerHTML = "";
});
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const button = (host: ReturnType<typeof mount>, label: string) =>
  host.findAll("button").find((item) => item.text() === label)!;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.choose.mockResolvedValue("here");
  mocks.workspace = reactive({
    folderPath: null as string | null,
    isRepo: false,
    recent: ["A", "B"],
    token: 0,
    navigationToken() {
      return this.token;
    },
    openFolder(path: string) {
      ++this.token;
      return mocks.open(path);
    },
    initRepo(path: string, branch: string) {
      ++this.token;
      return mocks.init(path, branch);
    },
  });
  mocks.layout = reactive({ leftOpen: false, bottomOpen: false, activeBottomTab: "console" });
  const accept = (path: string) => {
    mocks.workspace.folderPath = path;
    mocks.workspace.isRepo = true;
  };
  mocks.open.mockImplementation(async (path) => accept(path));
  mocks.init.mockImplementation(async (path) => accept(path));
});

it("shows progress immediately and does not repeat slow recent-folder opens", async () => {
  const read = deferred();
  mocks.open.mockReturnValue(read.promise);
  const host = mount(WelcomeView);
  await button(host, "A").trigger("click");
  expect(host.get('[role="status"]').text()).toContain("common.loading");
  expect(host.get('[role="status"]').text()).toContain("A");
  expect(host.findAll("button").every((entry) => entry.attributes("disabled") !== undefined)).toBe(
    true,
  );
  await button(host, "A").trigger("click");
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith("A");
  mocks.workspace.folderPath = "A";
  mocks.workspace.isRepo = true;
  read.resolve(undefined);
  await flushPromises();
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.log).toHaveBeenCalledExactlyOnceWith(true);
  expect(mocks.branches).toHaveBeenCalledOnce();
  expect(host.find('[role="status"]').exists()).toBe(false);
});

it("releases the entry after cancelling a picker and never opens two pickers", async () => {
  const pick = deferred();
  mocks.pick.mockReturnValue(pick.promise);
  const host = mount(WelcomeView);
  await button(host, "welcome.open").trigger("click");
  await button(host, "welcome.open").trigger("click");
  await flushPromises();
  expect(mocks.pick).toHaveBeenCalledOnce();
  pick.resolve(null);
  await flushPromises();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(button(host, "welcome.open").attributes("disabled")).toBeUndefined();
  expect(host.find('[role="alert"]').exists()).toBe(false);
});

it("does not refresh or switch panels when an earlier navigation finishes late", async () => {
  const read = deferred();
  mocks.open.mockReturnValue(read.promise);
  const host = mount(WelcomeView);
  await button(host, "A").trigger("click");
  ++mocks.workspace.token;
  mocks.workspace.folderPath = "B";
  mocks.workspace.isRepo = true;
  read.resolve(undefined);
  await flushPromises();
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.log).not.toHaveBeenCalled();
  expect(mocks.layout.activeBottomTab).toBe("console");
});

it("shows a readable failure and lets the same entry retry", async () => {
  mocks.open.mockRejectedValueOnce({ code: "FsError", message: "Directory is unavailable" });
  const host = mount(WelcomeView);
  await button(host, "A").trigger("click");
  await flushPromises();
  expect(host.get('[role="alert"]').text()).toBe("Directory is unavailable");
  expect(button(host, "A").attributes("disabled")).toBeUndefined();
  await button(host, "A").trigger("click");
  await flushPromises();
  expect(mocks.open).toHaveBeenCalledTimes(2);
  expect(host.find('[role="alert"]').exists()).toBe(false);
  expect(mocks.log).toHaveBeenCalledOnce();
});

it("drops a picker result and late errors after another navigation takes over", async () => {
  const pick = deferred();
  mocks.pick.mockReturnValue(pick.promise);
  const host = mount(WelcomeView);
  await button(host, "welcome.open").trigger("click");
  await flushPromises();
  ++mocks.workspace.token;
  pick.resolve("A");
  await flushPromises();
  expect(mocks.open).not.toHaveBeenCalled();
  const read = deferred();
  mocks.open.mockReturnValue(read.promise);
  await button(host, "A").trigger("click");
  ++mocks.workspace.token;
  read.reject(new Error("obsolete failure"));
  await flushPromises();
  expect(host.find('[role="alert"]').exists()).toBe(false);
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("creates once after choosing a directory and reports picker failures", async () => {
  mocks.pick.mockRejectedValueOnce(new Error("picker unavailable"));
  const host = mount(WelcomeView);
  await button(host, "welcome.create").trigger("click");
  await flushPromises();
  expect(host.get('[role="alert"]').text()).toBe("picker unavailable");
  mocks.pick.mockResolvedValueOnce("NewRepo");
  const create = deferred();
  mocks.init.mockReturnValueOnce(create.promise);
  await button(host, "welcome.create").trigger("click");
  await flushPromises();
  await button(host, "welcome.create").trigger("click");
  expect(mocks.init).toHaveBeenCalledExactlyOnceWith("NewRepo", "main");
  create.resolve(undefined);
  await flushPromises();
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
    title: "welcome.repoCreated",
    description: "NewRepo",
  });
});

it("shares busy state with the title bar and completes reads after Welcome unmounts", async () => {
  const Host = defineComponent({
    components: { WelcomeView, TitleBar },
    setup: () => ({ workspace: mocks.workspace }),
    template: '<TitleBar /><WelcomeView v-if="!workspace.folderPath" />',
  });
  const host = mount(Host, {
    global: { stubs: { WindowControls: true, Tip: { inheritAttrs: false, template: "<slot />" } } },
  });
  const open = deferred();
  const status = deferred();
  mocks.open.mockReturnValueOnce(open.promise);
  mocks.refresh.mockReturnValueOnce(status.promise);
  await button(host, "A").trigger("click");
  const toolbarButton = host
    .findComponent(TitleBar)
    .findAll("button")
    .find((entry) => entry.text().includes("common.loading"))!;
  expect(toolbarButton.attributes("disabled")).toBeDefined();
  await toolbarButton.trigger("click");
  expect(mocks.pick).not.toHaveBeenCalled();
  mocks.workspace.folderPath = "A";
  mocks.workspace.isRepo = true;
  open.resolve(undefined);
  await flushPromises();
  expect(host.findComponent(WelcomeView).exists()).toBe(false);
  // Each independent read starts immediately even with status still pending.
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.log).toHaveBeenCalledOnce();
  expect(mocks.branches).toHaveBeenCalledOnce();
  expect(toolbarButton.attributes("disabled")).toBeDefined();
  status.resolve(undefined);
  await flushPromises();
  expect(toolbarButton.attributes("disabled")).toBeUndefined();
  expect(mocks.action).not.toHaveBeenCalled();
});

it("title-bar opens use the same single refresh path and remain retryable on failure", async () => {
  const host = mount(TitleBar, {
    attachTo: document.body,
    global: { stubs: { WindowControls: true, Tip: { inheritAttrs: false, template: "<slot />" } } },
  });
  mocks.pick.mockResolvedValueOnce("A");
  await button(host, "welcome.openFolder").trigger("click");
  await flushPromises();
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find((b) => b.textContent?.includes("welcome.open"))!
    .click();
  await flushPromises();
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith("A");
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.log).toHaveBeenCalledOnce();
  expect(mocks.branches).toHaveBeenCalledOnce();
  expect(mocks.action).not.toHaveBeenCalled();
  mocks.pick.mockResolvedValueOnce("B");
  mocks.open.mockRejectedValueOnce(new Error("B is unavailable"));
  await button(host, "A").trigger("click");
  await flushPromises();
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find((b) => b.textContent?.includes("welcome.open"))!
    .click();
  await flushPromises();
  expect(mocks.toast).toHaveBeenLastCalledWith({ title: "B is unavailable" });
  expect(button(host, "A").attributes("disabled")).toBeUndefined();
});

it("opens recent projects with the title menu keyboard and closes on navigation", async () => {
  const host = mount(TitleBar, {
    attachTo: document.body,
    global: { stubs: { WindowControls: true, Tip: { inheritAttrs: false, template: "<slot />" } } },
  });
  await host.get('[aria-label="toolbar.recentProjects"]').trigger("click");
  await flushPromises();
  const target = document.querySelector<HTMLButtonElement>('[aria-label="B"]')!;
  target.focus();
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  await flushPromises();
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith("B");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await host.get('[aria-label="toolbar.recentProjects"]').trigger("click");
  await flushPromises();
  ++mocks.workspace.token;
  await flushPromises();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("deduplicates Windows recent paths and marks the current project", async () => {
  mocks.workspace.folderPath = "C:/Work/Repo";
  mocks.workspace.recent = [
    "C:\\Work\\Repo",
    "c:/work/repo/",
    "D:/Work/Repo",
    "/tmp/Repo",
    "/tmp/repo",
  ];
  const host = mount(TitleBar, {
    attachTo: document.body,
    global: { stubs: { WindowControls: true, Tip: { inheritAttrs: false, template: "<slot />" } } },
  });
  await host.get('[aria-label="toolbar.recentProjects"]').trigger("click");
  await flushPromises();
  const paths = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="menuitem"][aria-label]'),
  );
  expect(paths).toHaveLength(4);
  expect(paths[0]!.getAttribute("aria-current")).toBe("page");
  expect(paths[0]!.disabled).toBe(true);
  expect(paths[1]!.disabled).toBe(false);
  paths[1]!.click();
  await flushPromises();
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith("D:/Work/Repo");
});

it("keeps progress until all initial reads settle and reports a refresh failure after opening", async () => {
  const status = deferred();
  const log = deferred();
  mocks.refresh.mockReturnValueOnce(status.promise);
  mocks.log.mockReturnValueOnce(log.promise);
  const host = mount(WelcomeView);
  await button(host, "A").trigger("click");
  await flushPromises();
  status.reject(new Error("status could not be read"));
  await flushPromises();
  expect(button(host, "A").attributes("disabled")).toBeDefined();
  expect(mocks.toast).not.toHaveBeenCalled();
  log.resolve(undefined);
  await flushPromises();
  expect(button(host, "A").attributes("disabled")).toBeUndefined();
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
    title: "rewrite.refreshFailed",
    description: "status could not be read",
  });
});

it("releases an obsolete open immediately and never lets its finally clear a newer open", async () => {
  const oldOpen = deferred();
  const nextOpen = deferred();
  mocks.open.mockReturnValueOnce(oldOpen.promise).mockReturnValueOnce(nextOpen.promise);
  const host = mount(WelcomeView);
  await button(host, "A").trigger("click");
  // A different entry has started navigating, while A's old disk read is still pending.
  ++mocks.workspace.token;
  await flushPromises();
  expect(button(host, "B").attributes("disabled")).toBeUndefined();
  expect(host.find('[role="status"]').exists()).toBe(false);
  await button(host, "B").trigger("click");
  expect(mocks.open).toHaveBeenNthCalledWith(2, "B");
  oldOpen.resolve(undefined);
  await flushPromises();
  expect(host.get('[role="status"]').text()).toContain("B");
  expect(button(host, "A").attributes("disabled")).toBeDefined();
  expect(mocks.refresh).not.toHaveBeenCalled();
  nextOpen.resolve(undefined);
  await flushPromises();
  expect(host.find('[role="status"]').exists()).toBe(false);
});

it("removes stale loading from the persistent title bar before the old request settles", async () => {
  const oldOpen = deferred();
  mocks.open.mockReturnValueOnce(oldOpen.promise);
  const Host = defineComponent({
    components: { WelcomeView, TitleBar },
    setup: () => ({ workspace: mocks.workspace }),
    template: '<TitleBar /><WelcomeView v-if="!workspace.folderPath" />',
  });
  const host = mount(Host, {
    global: { stubs: { WindowControls: true, Tip: { inheritAttrs: false, template: "<slot />" } } },
  });
  await button(host, "A").trigger("click");
  ++mocks.workspace.token;
  mocks.workspace.folderPath = "B";
  mocks.workspace.isRepo = true;
  await flushPromises();
  expect(host.findComponent(WelcomeView).exists()).toBe(false);
  expect(button(host, "B").attributes("disabled")).toBeUndefined();
  expect(host.text()).not.toContain("common.loading");
  oldOpen.reject(new Error("obsolete failure"));
  await flushPromises();
  expect(mocks.toast).not.toHaveBeenCalled();
});
