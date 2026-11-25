import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { defineComponent, onMounted, ref } from "vue";
import { Splitpanes } from "splitpanes";
import App from "./App.vue";
import { useLayoutStore } from "@/stores/layoutStore";
import { i18n } from "@/i18n";

vi.mock("@/composables/useRepositoryRefresh", () => ({ useRepositoryRefresh: () => {} }));
vi.mock("@/composables/useAppEvents", () => ({ useAppEvents: () => {} }));
vi.mock("@/composables/useWindowTitle", () => ({ useWindowTitle: () => {} }));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({ settings: null, load: async () => {} }),
}));
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: () => ({
    folderPath: null,
    loadRecent: async () => {},
    detectGit: async () => {},
  }),
}));
vi.mock("@/stores/consoleStore", () => ({ useConsoleStore: () => ({ append: () => {} }) }));
vi.mock("@/stores/updateStore", () => ({
  useUpdateStore: () => ({ startAutoChecks: () => {}, stopAutoChecks: () => {} }),
}));

enableAutoUnmount(afterEach);
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
});
afterEach(() => {
  disposePinia(pinia);
  localStorage.clear();
});

function setupApp() {
  const mounts = { commit: 0, file: 0 };
  const content = (kind: "commit" | "file") =>
    defineComponent({
      setup() {
        const draft = ref("");
        onMounted(() => mounts[kind]++);
        return { draft };
      },
      template: `<div data-panel="${kind}"><input v-model="draft" /></div>`,
    });
  const wrapper = mount(App, {
    attachTo: document.body,
    global: {
      plugins: [i18n],
      stubs: {
        TooltipProvider: { template: "<div><slot /></div>" },
        WorkspacePanels: { template: '<div><slot name="editor" /></div>' },
        CommitToolWindow: content("commit"),
        FileToolWindow: content("file"),
        TitleBar: true,
        ToolWindowStripe: true,
        EditorTabs: true,
        GitToolWindow: true,
        StatusBar: true,
        JobsPopup: true,
        FindActionPalette: true,
        VcsOperationsPopup: true,
        CustomContextMenuHost: true,
        ToastHost: true,
        DialogHost: true,
        BranchesPopup: true,
      },
    },
  });
  return { wrapper, mounts };
}

it("keeps Commit and File contents and shared width through switching and closing the dock", async () => {
  const { wrapper, mounts } = setupApp();
  const layout = useLayoutStore();
  await flushPromises();
  await wrapper.get('[data-panel="commit"] input').setValue("commit draft");
  layout.showLeftTab("file");
  await flushPromises();
  expect(wrapper.get('[data-panel="commit"]').isVisible()).toBe(false);
  expect(wrapper.get('[data-panel="file"]').isVisible()).toBe(true);
  await wrapper.get('[data-panel="file"] input').setValue("file filter");
  wrapper.findComponent(Splitpanes).vm.$emit("resized", {
    event: new Event("mouseup"),
    panes: [{ size: 35 }, { size: 65 }],
  });
  await flushPromises();
  layout.toggleLeftTab("file");
  await flushPromises();
  expect(wrapper.get('[data-panel="file"]').isVisible()).toBe(false);
  expect(wrapper.findAll(".splitpanes__pane")[0]!.attributes("inert")).toBeDefined();
  layout.showLeftTab("commit");
  await flushPromises();
  expect((wrapper.get('[data-panel="commit"] input').element as HTMLInputElement).value).toBe(
    "commit draft",
  );
  layout.showLeftTab("file");
  await flushPromises();
  expect((wrapper.get('[data-panel="file"] input').element as HTMLInputElement).value).toBe(
    "file filter",
  );
  expect(mounts).toEqual({ commit: 1, file: 1 });
  expect(layout.leftSize).toBe(35);
  expect((wrapper.findAll(".splitpanes__pane")[0]!.element as HTMLElement).style.width).toBe("35%");
});

it("hides the floating Commit when File opens and restores the same Commit instance", async () => {
  const layout = useLayoutStore();
  layout.commitTwMode = "float";
  layout.leftOpen = false;
  const { wrapper, mounts } = setupApp();
  await flushPromises();
  await wrapper.get('[data-panel="commit"] input').setValue("floating draft");
  layout.showLeftTab("file");
  await flushPromises();
  expect(wrapper.get('[data-panel="commit"]').isVisible()).toBe(false);
  expect(wrapper.get('[data-panel="file"]').isVisible()).toBe(true);
  layout.showLeftTab("commit");
  await flushPromises();
  expect(wrapper.get('[data-panel="commit"]').isVisible()).toBe(true);
  expect(wrapper.get('[data-panel="file"]').isVisible()).toBe(false);
  expect((wrapper.get('[data-panel="commit"] input').element as HTMLInputElement).value).toBe(
    "floating draft",
  );
  expect(mounts).toEqual({ commit: 1, file: 1 });
});
