import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { defineComponent, h, nextTick } from "vue";
import { useAppEvents } from "./useAppEvents";
import { useJobsStore } from "@/stores/jobsStore";
import JobsPopup from "@/components/layout/JobsPopup.vue";

const m = vi.hoisted(() => ({ list: vi.fn(), cancel: vi.fn(), listen: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ jobList: m.list, jobCancel: m.cancel }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: m.listen }));
vi.mock("@/lib/utils", async (original) => ({
  ...(await original<typeof import("@/lib/utils")>()),
  isTauri: () => true,
}));
vi.mock("@/stores/consoleStore", () => ({ useConsoleStore: () => ({ append: vi.fn() }) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const Host = defineComponent({
  setup() {
    useAppEvents();
    return () => h(JobsPopup);
  },
});
let pinia: ReturnType<typeof createPinia>;
let host: VueWrapper | undefined;
let listeners: Map<string, (event: { payload: Record<string, unknown> }) => void>;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  listeners = new Map();
  m.listen.mockImplementation(async (name, callback) => {
    listeners.set(name, callback);
    return () => listeners.delete(name);
  });
  m.list.mockResolvedValue([]);
  m.cancel.mockResolvedValue(true);
});
afterEach(() => {
  host?.unmount();
  host = undefined;
  disposePinia(pinia);
  document.body.innerHTML = "";
});

async function open() {
  host = mount(Host, { attachTo: document.body, global: { plugins: [pinia] } });
  await flushPromises();
  const jobs = useJobsStore();
  jobs.popupOpen = true;
  await nextTick();
  return jobs;
}
function emit(name: string, payload: Record<string, unknown>) {
  const listener = listeners.get(`job://${name}`);
  expect(listener).toBeTypeOf("function");
  listener!({ payload });
}
function cancelButton() {
  return document.querySelector<HTMLButtonElement>('[role="dialog"] button');
}
const native = { id: "clone", title: "Clone project", cancellable: true, startedAt: 1234 };

it("uses native start metadata and exposes cancellation before another list read", async () => {
  const jobs = await open();
  emit("started", native);
  await nextTick();
  expect(jobs.running[0]).toMatchObject(native);
  expect(cancelButton()?.disabled).toBe(false);
  cancelButton()!.click();
  await flushPromises();
  expect(m.cancel).toHaveBeenCalledExactlyOnceWith("clone");
  expect(m.list).toHaveBeenCalledOnce();
});

it("retains snapshot metadata, progress and row order when a sparse start arrives late", async () => {
  const jobs = await open();
  m.list.mockResolvedValueOnce([native, { id: "other", title: "Other", startedAt: 2 }]);
  await jobs.refresh();
  emit("progress", { id: "clone", percent: 42, message: "Receiving objects" });
  emit("started", { id: "clone" });
  await nextTick();
  expect(jobs.running.map((job) => job.id)).toEqual(["clone", "other"]);
  expect(jobs.running[0]).toMatchObject({ ...native, percent: 42, message: "Receiving objects" });
  expect(cancelButton()?.disabled).toBe(false);
  expect(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("42");
});

it("keeps cancellation and progress visible across a duplicate start until completion", async () => {
  const jobs = await open();
  emit("started", native);
  emit("progress", { id: "clone", percent: 75, message: "Resolving deltas" });
  await jobs.cancel("clone");
  emit("started", { id: "clone", title: "Clone project" });
  await nextTick();
  expect(jobs.running[0]).toMatchObject({ ...native, cancelling: true, percent: 75 });
  expect(cancelButton()?.disabled).toBe(true);
  expect(await jobs.cancel("clone")).toBe(false);
  expect(m.cancel).toHaveBeenCalledOnce();
  emit("finished", { id: "clone" });
  await nextTick();
  expect(jobs.count).toBe(0);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("status.jobsEmpty");
});

it("honors explicit false cancellation and zero native time without erasing progress", async () => {
  const jobs = await open();
  emit("started", native);
  emit("progress", { id: "clone", percent: 0, message: "" });
  emit("started", { ...native, cancellable: false, startedAt: 0 });
  await nextTick();
  expect(jobs.running[0]).toMatchObject({
    cancellable: false,
    startedAt: 0,
    percent: 0,
    message: "",
  });
  expect(cancelButton()).toBeNull();
  expect(await jobs.cancel("clone")).toBe(false);
  expect(m.cancel).not.toHaveBeenCalled();
});

it("keeps first observation time when an older sender repeats a start without time", async () => {
  const jobs = await open();
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  try {
    emit("started", { id: "old", title: "Old sender" });
    now.mockReturnValue(9000);
    emit("started", { id: "old", title: "Old sender" });
    expect(jobs.running[0]?.startedAt).toBe(1000);
  } finally {
    now.mockRestore();
  }
});

it("preserves a new event when the preceding list response returns later", async () => {
  const jobs = await open();
  let finish!: (value: unknown[]) => void;
  m.list.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const reading = jobs.refresh();
  emit("started", native);
  finish([]);
  await reading;
  expect(jobs.running[0]).toMatchObject(native);
  expect(jobs.count).toBe(1);
});

it("does not inherit cancelled progress after a completed id is reused", async () => {
  const jobs = await open();
  emit("started", native);
  emit("progress", { id: "clone", percent: 90, message: "Old output" });
  await jobs.cancel("clone");
  emit("finished", { id: "clone" });
  emit("started", { id: "clone", title: "New task", cancellable: false });
  expect(jobs.count).toBe(1);
  expect(jobs.running[0]).toMatchObject({ title: "New task", cancellable: false });
  expect(jobs.running[0]?.percent).toBeUndefined();
  expect(jobs.running[0]?.message).toBeUndefined();
  expect(jobs.running[0]?.cancelling).toBeUndefined();
});
