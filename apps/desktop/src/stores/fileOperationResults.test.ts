import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { useWorkspaceStore } from "./workspaceStore";
import { useFileTreeStore } from "./fileTreeStore";
import { useFileViewerStore } from "./fileViewerStore";
import { useFileOperationsStore } from "./fileOperationsStore";
import { useJobsStore } from "./jobsStore";
import { i18n } from "@/i18n";
import type { FsEntry, FsMutateResult } from "@/lib/backend";

const m = vi.hoisted(() => ({
  workspaceOpen: vi.fn(),
  workspaceRecent: vi.fn(),
  fsReadDir: vi.fn(),
  fsReadFile: vi.fn(),
  fsMutate: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
  toast: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock("./changesStore", () => ({
  useChangesStore: () => ({ refresh: m.refresh, snapshot: null }),
}));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: m.confirm, promptDialog: m.prompt }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const source = "C:/project";
const successful: FsMutateResult = {
  completed: [{ path: "a.txt", destination: "copies/a.txt" }],
  failures: [],
};
const partial: FsMutateResult = {
  ...successful,
  failures: [{ path: "b.txt", message: "destination exists" }],
};
let pinia: Pinia;
beforeEach(async () => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  m.workspaceOpen.mockImplementation(async ({ path }) => ({
    path,
    isRepo: false,
    gitDir: null,
    commonDir: null,
    toplevel: null,
  }));
  m.workspaceRecent.mockResolvedValue({ paths: [] });
  m.fsReadDir.mockResolvedValue([{ path: "a.txt", name: "a.txt", kind: "file" }]);
  m.fsReadFile.mockResolvedValue("saved text");
  m.fsMutate.mockResolvedValue(successful);
  m.confirm.mockResolvedValue(true);
  m.prompt.mockResolvedValue("new.txt");
  await useWorkspaceStore().openFolder(source);
  await useFileTreeStore().loadRoot();
  await useFileViewerStore().open("a.txt");
});
afterEach(() => disposePinia(pinia));

function resultNotice(completed: number, failed: number) {
  expect(m.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: i18n.global.t(failed ? "fileOps.failed" : "fileOps.completed"),
      description: expect.stringContaining(source),
    }),
  );
  const notice = m.toast.mock.calls.find(
    ([item]) => item.title === i18n.global.t(failed ? "fileOps.failed" : "fileOps.completed"),
  )![0];
  expect(notice.description).toContain(i18n.global.t("fileOps.copy"));
  expect(notice.description).toContain(
    i18n.global.t("fileOps.resultSummary", { completed, failed }),
  );
  if (failed) expect(notice.persistent).toBe(true);
  return notice;
}
function released() {
  expect(useFileOperationsStore().busy).toBe(false);
  expect(useFileViewerStore().fileMutationPending).toBe(false);
  expect(useFileOperationsStore().activityTitle).toBe("");
}

it.each(["C:/other", source])(
  "reports a completed source operation after opening %s without refreshing the new tree",
  async (path) => {
    const mutation = deferred<FsMutateResult>();
    m.fsMutate.mockReturnValueOnce(mutation.promise);
    const operation = useFileOperationsStore().run("copy", ["a.txt"], "copies");
    await flushPromises();
    await useWorkspaceStore().openFolder(path);
    await useFileTreeStore().loadRoot();
    const reads = m.fsReadDir.mock.calls.length;
    const newer = useJobsStore().begin("new task", path);
    expect(useJobsStore().running.map((job) => job.message)).toEqual([source, path]);
    expect(useFileViewerStore().fileMutationPending).toBe(true);
    mutation.resolve(successful);
    await operation;
    resultNotice(1, 0);
    expect(m.fsReadDir).toHaveBeenCalledTimes(reads);
    expect(m.refresh).not.toHaveBeenCalled();
    expect(useJobsStore().running.map((job) => job.id)).toEqual([newer]);
    released();
  },
);

it("reports partial source results after navigation with completed count and persistent failures", async () => {
  const mutation = deferred<FsMutateResult>();
  m.fsMutate.mockReturnValueOnce(mutation.promise);
  const operation = useFileOperationsStore().run("copy", ["a.txt", "b.txt"], "copies");
  await flushPromises();
  await useWorkspaceStore().openFolder("C:/other");
  mutation.resolve(partial);
  await operation;
  expect(resultNotice(1, 1).description).toContain("b.txt: destination exists");
  expect(useJobsStore().count).toBe(0);
  released();
});

it("reports rejected source writes after navigation and allows a later retry", async () => {
  const mutation = deferred<FsMutateResult>();
  m.fsMutate.mockReturnValueOnce(mutation.promise);
  const operation = useFileOperationsStore().run("copy", ["a.txt"], "copies");
  await flushPromises();
  await useWorkspaceStore().openFolder("C:/other");
  mutation.reject(new Error("disk unavailable"));
  await operation;
  expect(m.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: i18n.global.t("fileOps.failed"),
      persistent: true,
      description: expect.stringContaining(`${source}\ndisk unavailable`),
    }),
  );
  released();
  expect(useJobsStore().count).toBe(0);
  await useFileOperationsStore().run("copy", ["a.txt"], "copies");
  expect(m.fsMutate).toHaveBeenCalledTimes(2);
});

it.each([successful, partial])(
  "reports disk results before a slow directory refresh settles: %j",
  async (result) => {
    const refresh = deferred<FsEntry[]>();
    m.fsReadDir.mockReturnValueOnce(refresh.promise);
    m.fsMutate.mockResolvedValueOnce(result);
    const operation = useFileOperationsStore().run("copy", ["a.txt", "b.txt"], "copies");
    await flushPromises();
    const noticesDuringRefresh = [...m.toast.mock.calls];
    const activeDuringRefresh = useJobsStore().count;
    const queueTitle = useJobsStore().running[0]?.title;
    const panelTitle = useFileOperationsStore().activityTitle;
    const lockedDuringRefresh = useFileViewerStore().fileMutationPending;
    refresh.resolve([]);
    await operation;
    expect(noticesDuringRefresh).toHaveLength(1);
    resultNotice(1, result.failures.length);
    expect(activeDuringRefresh).toBe(1);
    expect(queueTitle).toBe(i18n.global.t("fileOps.refreshing"));
    expect(panelTitle).toBe(queueTitle);
    expect(lockedDuringRefresh).toBe(false);
    expect(m.toast).toHaveBeenCalledTimes(1);
    expect(useJobsStore().count).toBe(0);
    released();
  },
);

it("shows the opening stage until a newly created file is readable", async () => {
  const reading = deferred<string>();
  m.fsReadFile.mockReturnValueOnce(reading.promise);
  m.fsMutate.mockResolvedValueOnce({
    completed: [{ path: "new.txt", destination: null }],
    failures: [],
  });
  const operation = useFileOperationsStore().run("createFile", [""]);
  await flushPromises();
  const title = useJobsStore().running[0]?.title;
  const panelTitle = useFileOperationsStore().activityTitle;
  const notices = m.toast.mock.calls.length;
  reading.resolve("new file");
  await operation;
  expect(title).toBe(i18n.global.t("fileOps.opening"));
  expect(panelTitle).toBe(title);
  expect(notices).toBe(1);
  expect(useFileViewerStore().tabs.at(-1)?.text).toBe("new file");
  expect(useJobsStore().count).toBe(0);
  released();
});

it("retains the reported partial result if navigation occurs during directory refresh", async () => {
  const refresh = deferred<FsEntry[]>();
  m.fsReadDir.mockReturnValueOnce(refresh.promise);
  m.fsMutate.mockResolvedValueOnce(partial);
  const operation = useFileOperationsStore().run("copy", ["a.txt", "b.txt"], "copies");
  await flushPromises();
  await useWorkspaceStore().openFolder("C:/other");
  refresh.resolve([]);
  await operation;
  resultNotice(1, 1);
  expect(m.toast).toHaveBeenCalledTimes(1);
  expect(useFileTreeStore().initialized).toBe(false);
  expect(useJobsStore().count).toBe(0);
});

it("keeps a real directory-read failure separate from the already completed file operation", async () => {
  m.fsReadDir.mockRejectedValueOnce(new Error("directory unavailable"));
  await useFileOperationsStore().run("copy", ["a.txt"], "copies");
  expect(useFileTreeStore().error).toBe("directory unavailable");
  resultNotice(1, 0);
  expect(m.toast).not.toHaveBeenCalledWith(
    expect.objectContaining({ title: i18n.global.t("fileOps.failed") }),
  );
  expect(m.fsMutate).toHaveBeenCalledOnce();
  released();
});

it.each(["success", "failure"])(
  "does not publish %s after the file-operation store is disposed",
  async (outcome) => {
    const mutation = deferred<FsMutateResult>();
    m.fsMutate.mockReturnValueOnce(mutation.promise);
    const store = useFileOperationsStore();
    const operation = store.run("copy", ["a.txt"], "copies");
    await flushPromises();
    store.$dispose();
    if (outcome === "success") mutation.resolve(partial);
    else mutation.reject(new Error("old failure"));
    await operation;
    expect(m.toast).not.toHaveBeenCalled();
    expect(m.fsReadDir).toHaveBeenCalledOnce();
    expect(useJobsStore().count).toBe(0);
  },
);

it("does not write or notify when navigation invalidates a pending confirmation", async () => {
  const answer = deferred<boolean>();
  m.confirm.mockReturnValueOnce(answer.promise);
  const operation = useFileOperationsStore().run("copy", ["a.txt"], "copies");
  await useWorkspaceStore().openFolder("C:/other");
  answer.resolve(true);
  await operation;
  expect(m.fsMutate).not.toHaveBeenCalled();
  expect(m.toast).not.toHaveBeenCalled();
  expect(useJobsStore().count).toBe(0);
});

it("does not open a created file in another workspace when its write finishes late", async () => {
  const mutation = deferred<FsMutateResult>();
  m.fsMutate.mockReturnValueOnce(mutation.promise);
  const operation = useFileOperationsStore().run("createFile", [""]);
  await flushPromises();
  await useWorkspaceStore().openFolder("C:/other");
  mutation.resolve({ completed: [{ path: "new.txt", destination: null }], failures: [] });
  await operation;
  expect(useFileViewerStore().tabs).toHaveLength(0);
  expect(m.fsReadFile).toHaveBeenCalledOnce();
  expect(m.toast).toHaveBeenCalledWith(
    expect.objectContaining({ description: expect.stringContaining(source) }),
  );
  released();
});
