import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import App from "./App.vue";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const m = vi.hoisted(() => ({
  settingsLoad: vi.fn(),
  recent: vi.fn(),
  gitDetect: vi.fn(),
  append: vi.fn(),
  toast: vi.fn(),
  startUpdates: vi.fn(),
  stopUpdates: vi.fn(),
  run: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ workspaceRecent: m.recent, gitDetect: m.gitDetect }),
}));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({ settings: null, load: m.settingsLoad }),
}));
vi.mock("@/stores/consoleStore", () => ({ useConsoleStore: () => ({ append: m.append }) }));
vi.mock("@/stores/updateStore", () => ({
  useUpdateStore: () => ({ startAutoChecks: m.startUpdates, stopAutoChecks: m.stopUpdates }),
}));
vi.mock("@/composables/useRepositoryRefresh", () => ({ useRepositoryRefresh: () => {} }));
vi.mock("@/composables/useAppEvents", () => ({ useAppEvents: () => {} }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/actions/registry", () => ({ listActions: () => [] }));
vi.mock("@/actions", async () => ({ ...(await import("@/actions/keymap")), runAction: m.run }));

enableAutoUnmount(afterEach);
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  m.recent.mockResolvedValue({ paths: ["repo"] });
  m.gitDetect.mockResolvedValue({ path: "git", version: "git version test" });
});
afterEach(() => disposePinia(pinia));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("detects Git and reports startup success while recent projects are still loading", async () => {
  const recent = deferred<{ paths: string[] }>();
  m.recent.mockReturnValueOnce(recent.promise);
  shallowMount(App);
  try {
    await flushPromises();
    expect(m.recent).toHaveBeenCalledOnce();
    expect(m.gitDetect).toHaveBeenCalledOnce();
    expect(m.append).toHaveBeenCalledWith("cmd", "# git detected: git");
    expect(m.append).toHaveBeenCalledWith("stdout", "git version test");
    expect(m.startUpdates).toHaveBeenCalledOnce();
  } finally {
    recent.resolve({ paths: ["late repo"] });
    await flushPromises();
  }
  expect(useWorkspaceStore().recent).toEqual(["late repo"]);
});

it("still loads settings before Git detection and stops initialization after unmount", async () => {
  const settings = deferred<void>();
  m.settingsLoad.mockReturnValueOnce(settings.promise);
  const wrapper = shallowMount(App);
  await flushPromises();
  expect(m.startUpdates).toHaveBeenCalledOnce();
  expect(m.recent).not.toHaveBeenCalled();
  expect(m.gitDetect).not.toHaveBeenCalled();
  wrapper.unmount();
  settings.resolve();
  await flushPromises();
  expect(m.recent).not.toHaveBeenCalled();
  expect(m.gitDetect).not.toHaveBeenCalled();
  expect(m.append).not.toHaveBeenCalled();
  expect(m.stopUpdates).toHaveBeenCalledOnce();
});

it("does not publish late Git detection feedback after unmount", async () => {
  const git = deferred<{ path: string; version: string }>();
  m.gitDetect.mockReturnValueOnce(git.promise);
  const wrapper = shallowMount(App);
  await flushPromises();
  expect(m.gitDetect).toHaveBeenCalledOnce();
  wrapper.unmount();
  git.resolve({ path: "late git", version: "late version" });
  await flushPromises();
  expect(m.append).not.toHaveBeenCalled();
  expect(m.toast).not.toHaveBeenCalled();
});
