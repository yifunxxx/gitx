import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import DialogHost from "@/components/common/DialogHost.vue";
import { closeDialog, openDialog, useDialogStack } from "@/composables/useDialog";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useFileViewerStore } from "@/stores/fileViewerStore";
import { useJobsStore } from "@/stores/jobsStore";
import { useFileOperationsStore } from "@/stores/fileOperationsStore";
import FileSearchDialog from "./FileSearchDialog.vue";

const m = vi.hoisted(() => ({
  backend: {
    workspaceOpen: vi.fn(),
    workspaceRecent: vi.fn(),
    fsReadFile: vi.fn(),
    fsStartContentSearch: vi.fn(),
    fsContentSearchPage: vi.fn(),
    fsCancelSearch: vi.fn(),
    fsReplaceContent: vi.fn(),
    fsMutate: vi.fn(),
  },
  toast: vi.fn(),
  refresh: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m.backend }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: m.confirm, promptDialog: vi.fn() }));
vi.mock("@/stores/fileTreeStore", () => ({
  useFileTreeStore: () => ({ refreshExpanded: vi.fn() }),
}));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: m.refresh }) }));
vi.mock("@/stores/conflictsStore", () => ({
  useConflictsStore: () => ({ busy: false, mergeTabs: [] }),
}));
vi.mock("vue-i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-i18n")>()),
  useI18n: () => ({
    t: (key: string, args?: { count?: number }) =>
      args?.count === undefined ? key : `${key}:${args.count}`,
  }),
}));

let pinia: Pinia;
let host: VueWrapper;
let resolveReplace: (value: { completed: string[]; failed: string[] }) => void;
let rejectReplace: (reason: Error) => void;
let searchId: number;
const source = "C:/source";
const otherDialog = defineComponent({
  template: '<section role="dialog"><input id="new-dialog-draft" value="keep me" /></section>',
});

beforeEach(async () => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  pinia = createPinia();
  setActivePinia(pinia);
  m.backend.workspaceOpen.mockImplementation(async ({ path }) => ({
    path,
    isRepo: false,
    gitDir: null,
    commonDir: null,
    toplevel: null,
  }));
  m.backend.workspaceRecent.mockResolvedValue({ paths: [] });
  m.backend.fsReadFile.mockResolvedValue("hit");
  m.backend.fsStartContentSearch.mockResolvedValue(null);
  m.backend.fsCancelSearch.mockResolvedValue(null);
  m.backend.fsMutate.mockResolvedValue({ completed: [], failures: [] });
  m.confirm.mockResolvedValue(true);
  m.backend.fsContentSearchPage.mockResolvedValue({
    matches: [
      {
        path: "a.txt",
        line: 1,
        column: 1,
        preview: "hit",
        matchStart: 0,
        matchEnd: 3,
        replacementPreview: "new",
      },
    ],
    total: 1,
    files: 1,
    scanned: 1,
    skipped: 0,
    issues: [],
    done: true,
    error: null,
  });
  m.backend.fsReplaceContent.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        resolveReplace = resolve;
        rejectReplace = reject;
      }),
  );
  await useWorkspaceStore().openFolder(source);
  await useFileViewerStore().open("a.txt");
  host = mount(DialogHost, { attachTo: document.body, global: { plugins: [pinia] } });
  void openDialog(FileSearchDialog, { content: true, replace: true });
  searchId = useDialogStack().value.at(-1)!.id;
  await flushPromises();
  await host.get("[data-search-query]").setValue("hit");
  await vi.advanceTimersByTimeAsync(220);
  await flushPromises();
  await clickButton("contentSearch.replaceFiles:1");
  await clickButton("contentSearch.confirmReplace:1");
  expect(useFileViewerStore().fileMutationPending).toBe(true);
  expect(useJobsStore().running).toEqual([
    expect.objectContaining({ title: "contentSearch.replaceTitle", message: source }),
  ]);
});
afterEach(async () => {
  resolveReplace?.({ completed: [], failed: [] });
  await flushPromises();
  host?.unmount();
  disposePinia(pinia);
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function clickButton(text: string) {
  const button = host.findAll("button").find((item) => item.text() === text);
  expect(button, text).toBeDefined();
  await button!.trigger("click");
}
function expectReleased() {
  expect(useFileViewerStore().fileMutationPending).toBe(false);
  expect(useJobsStore().running).toEqual([]);
}

it.each(["C:/other", source])(
  "reports the source result after navigation to %s closes the dialog and retains its active job",
  async (path) => {
    await useWorkspaceStore().openFolder(path);
    await flushPromises();
    expect(useDialogStack().value.some((dialog) => dialog.id === searchId)).toBe(false);
    expect(useFileViewerStore().fileMutationPending).toBe(true);
    expect(useJobsStore().running).toHaveLength(1);
    resolveReplace({ completed: ["a.txt"], failed: [] });
    await flushPromises();
    expectReleased();
    expect(m.toast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: "contentSearch.replaced:1", description: source }),
    );
    expect(m.refresh).not.toHaveBeenCalled();
  },
);

it("removes only its own obsolete dialog and preserves a newer dialog's draft", async () => {
  void openDialog(otherDialog);
  await flushPromises();
  const newerId = useDialogStack().value.at(-1)!.id;
  await useWorkspaceStore().openFolder("C:/other");
  await flushPromises();
  expect(useDialogStack().value.map((dialog) => dialog.id)).toEqual([newerId]);
  expect(host.get<HTMLInputElement>("#new-dialog-draft").element.value).toBe("keep me");
  resolveReplace({ completed: [], failed: [] });
  await flushPromises();
  expect(useDialogStack().value.map((dialog) => dialog.id)).toEqual([newerId]);
  expectReleased();
});

it("reports completed files and the failure after navigation cancels the source search", async () => {
  await useWorkspaceStore().openFolder("C:/other");
  await flushPromises();
  resolveReplace({ completed: ["a.txt"], failed: ["b.txt: Search cancelled"] });
  await flushPromises();
  expect(m.toast).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      title: "contentSearch.replaced:1",
      description: `${source}\nb.txt: Search cancelled`,
      persistent: true,
    }),
  );
  expectReleased();
});

it("reports a detached replacement rejection with its source folder and releases its job", async () => {
  closeDialog(null, searchId);
  await flushPromises();
  rejectReplace(new Error("disk unavailable"));
  await flushPromises();
  expect(m.toast).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      title: "contentSearch.replaceTitle",
      description: `${source}\ndisk unavailable`,
      persistent: true,
    }),
  );
  expectReleased();
});

it("keeps Escape blocked for a current write and shows success in the current dialog", async () => {
  host
    .get('[role="dialog"]')
    .element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  await flushPromises();
  expect(useDialogStack().value.map((dialog) => dialog.id)).toContain(searchId);
  resolveReplace({ completed: ["a.txt"], failed: [] });
  await flushPromises();
  expect(useFileViewerStore().tabs).toHaveLength(0);
  expect(host.text()).toContain("contentSearch.replaced:1");
  expect(m.toast).not.toHaveBeenCalled();
  expectReleased();
});

it("preserves a newer draft in an affected tab and keeps a current error in the dialog", async () => {
  const viewer = useFileViewerStore();
  const tab = viewer.tabs[0]!;
  viewer.setDocument(tab.id, "new draft");
  resolveReplace({ completed: ["a.txt"], failed: ["b.txt: denied"] });
  await flushPromises();
  expect(viewer.tabs[0]).toMatchObject({ id: tab.id, text: "new draft", dirty: true });
  expect(host.get('[role="alert"]').text()).toContain("b.txt: denied");
  expect(m.toast).not.toHaveBeenCalled();
  expectReleased();
});

it("keeps other file operations from writing or releasing the replacement lock after navigation", async () => {
  await useWorkspaceStore().openFolder("C:/other");
  await flushPromises();
  await useFileOperationsStore().run("copy", ["a.txt"], "copies");
  expect(m.backend.fsMutate).not.toHaveBeenCalled();
  expect(m.confirm).not.toHaveBeenCalled();
  expect(useFileViewerStore().fileMutationPending).toBe(true);
  resolveReplace({ completed: [], failed: [] });
  await flushPromises();
  await useFileOperationsStore().run("copy", ["a.txt"], "copies");
  expect(m.backend.fsMutate).toHaveBeenCalledExactlyOnceWith({
    folderPath: "C:/other",
    operation: "copy",
    items: [{ path: "a.txt", destination: "copies/a.txt" }],
  });
  expectReleased();
});

it("rechecks the shared write lock when an earlier file-operation confirmation resolves", async () => {
  resolveReplace({ completed: [], failed: [] });
  await flushPromises();
  await clickButton("contentSearch.refresh");
  await vi.advanceTimersByTimeAsync(220);
  await flushPromises();
  let confirm!: (accepted: boolean) => void;
  m.confirm.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      confirm = resolve;
    }),
  );
  const copying = useFileOperationsStore().run("copy", ["a.txt"], "copies");
  await clickButton("contentSearch.replaceFiles:1");
  await clickButton("contentSearch.confirmReplace:1");
  confirm(true);
  await copying;
  expect(m.backend.fsMutate).not.toHaveBeenCalled();
  expect(useFileViewerStore().fileMutationPending).toBe(true);
  resolveReplace({ completed: [], failed: [] });
  await flushPromises();
  expectReleased();
});
