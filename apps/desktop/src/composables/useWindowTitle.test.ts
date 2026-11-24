import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWindowTitle } from "./useWindowTitle";

const m = vi.hoisted(() => ({
  setTitle: vi.fn(),
  workspaceOpen: vi.fn(),
  workspaceRecent: vi.fn(),
}));
vi.mock("@/lib/utils", async (original) => ({
  ...(await original<object>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle: m.setTitle }),
}));
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    workspaceOpen: m.workspaceOpen,
    workspaceRecent: m.workspaceRecent,
  }),
}));

let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  m.workspaceOpen.mockImplementation(async ({ path }: { path: string }) => ({
    path,
    isRepo: true,
    gitDir: `${path}/.git`,
    toplevel: path,
  }));
  m.workspaceRecent.mockResolvedValue({ paths: [] });
  m.setTitle.mockResolvedValue(undefined);
  document.title = "gitx";
});
afterEach(() => {
  disposePinia(pinia);
});

it("sets Welcome/default title then updates when a folder opens", async () => {
  useWindowTitle();
  await flushPromises();
  expect(document.title).toBe("gitx");
  expect(m.setTitle).toHaveBeenCalledWith("gitx");

  await useWorkspaceStore().openFolder("D:\\work\\demo-app");
  await flushPromises();
  expect(document.title).toBe("demo-app — gitx");
  expect(m.setTitle).toHaveBeenLastCalledWith("demo-app — gitx");
});
