import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import CloneDialog from "./CloneDialog.vue";

const mocks = vi.hoisted(() => ({
  cloneRun: vi.fn(),
  cloneCheckUrl: vi.fn(),
  jobCancel: vi.fn(),
  auth: vi.fn(),
  close: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("@/lib/utils", async (original) => ({ ...(await original<any>()), isTauri: () => false }));
vi.mock("@/composables/useCredentials", () => ({ handleAuthFailure: mocks.auth }));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: mocks.close,
  useDialogState: () => ({ value: { id: 23 } }),
}));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/composables/useConfirm", () => ({ promptDialog: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.jobCancel.mockResolvedValue(true);
});
enableAutoUnmount(afterEach);
afterEach(() => vi.useRealTimers());

async function submit(wrapper: ReturnType<typeof mount>) {
  if (wrapper.find("form").exists()) await wrapper.get("form").trigger("submit");
  else await wrapper.findAll("button").find((b) => b.text() === "Clone")!.trigger("click");
}

async function start() {
  const wrapper = mount(CloneDialog);
  await wrapper.findAll("input")[0]!.setValue("https://example.test/repo.git");
  await wrapper.findAll("input")[1]!.setValue("C:/qa/clone");
  await submit(wrapper);
  return wrapper;
}
const cancelButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll("button").find((b) => ["clone.cancel", "Cancel"].includes(b.text()))!;

it("retries cancellation before registration using only this attempt's unique job ID", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  mocks.jobCancel.mockRejectedValueOnce({ code: "notFound" }).mockResolvedValue(true);
  const wrapper = await start();
  const id = mocks.cloneRun.mock.calls[0]![0].jobId;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  await cancelButton(wrapper).trigger("click");
  await flushPromises();
  await vi.advanceTimersByTimeAsync(50);
  expect(mocks.jobCancel.mock.calls).toEqual([[id], [id]]);
  pending.reject({ code: "cancelled" });
  await flushPromises();
  expect(mocks.close).toHaveBeenCalledWith(null, 23);
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("stops pending cancellation retries when clone finishes before cancellation", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  mocks.jobCancel.mockRejectedValue({ code: "notFound" });
  const wrapper = await start();
  await cancelButton(wrapper).trigger("click");
  await flushPromises();
  pending.resolve({ path: "C:/qa/clone" });
  await flushPromises();
  await vi.advanceTimersByTimeAsync(300);
  expect(mocks.jobCancel).toHaveBeenCalledTimes(1);
  expect(mocks.close).toHaveBeenCalledWith(null, 23);
  expect(mocks.toast).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("cancels on unmount and ignores a late response without closing another dialog", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  const wrapper = await start();
  wrapper.unmount();
  expect(mocks.jobCancel).toHaveBeenCalledWith(mocks.cloneRun.mock.calls[0]![0].jobId);
  pending.resolve({ path: "C:/qa/clone" });
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("uses a new job ID for an authenticated retry and suppresses duplicate submissions", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun
    .mockRejectedValueOnce({ code: "authRequired" })
    .mockReturnValueOnce(pending.promise);
  mocks.auth.mockResolvedValue(true);
  const wrapper = await start();
  await flushPromises();
  await submit(wrapper);
  expect(mocks.cloneRun).toHaveBeenCalledTimes(2);
  const [first, second] = mocks.cloneRun.mock.calls;
  expect(second![0].jobId).not.toBe(first![0].jobId);
  await cancelButton(wrapper).trigger("click");
  expect(mocks.jobCancel).toHaveBeenCalledWith(second![0].jobId);
  pending.reject({ code: "cancelled" });
  await flushPromises();
  wrapper.unmount();
});

it("submits only once while the first clone is pending", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  const wrapper = await start();
  await submit(wrapper);
  await submit(wrapper);
  expect(mocks.cloneRun).toHaveBeenCalledTimes(1);
  expect(wrapper.findAll("input")[0]!.attributes("disabled")).toBeDefined();
  pending.resolve({ path: "C:/qa/clone" });
  await flushPromises();
  expect(mocks.close).toHaveBeenCalledWith("C:/qa/clone", 23);
});

it("ignores stale URL checks and clears a scheduled check on unmount", async () => {
  const older = deferred<boolean>();
  const newer = deferred<boolean>();
  mocks.cloneCheckUrl.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const wrapper = mount(CloneDialog);
  await wrapper.get("#clone-url").setValue("https://example.test/old");
  await vi.advanceTimersByTimeAsync(600);
  await wrapper.get("#clone-url").setValue("https://example.test/new");
  await vi.advanceTimersByTimeAsync(600);
  newer.resolve(true);
  await flushPromises();
  older.resolve(false);
  await flushPromises();
  expect(wrapper.text()).toContain("clone.found");
  expect(wrapper.text()).not.toContain("clone.checkFailed");
  await wrapper.get("#clone-url").setValue("https://example.test/unused");
  wrapper.unmount();
  await vi.advanceTimersByTimeAsync(600);
  expect(mocks.cloneCheckUrl).toHaveBeenCalledTimes(2);
});

it("keeps cancellation failures visible and allows retrying the same attempt", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  mocks.jobCancel.mockRejectedValueOnce(new Error("cancel connection failed")).mockResolvedValue(true);
  const wrapper = await start();
  await cancelButton(wrapper).trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("cancel connection failed");
  expect(mocks.close).not.toHaveBeenCalled();
  await cancelButton(wrapper).trigger("click");
  expect(mocks.jobCancel.mock.calls).toEqual([
    [mocks.cloneRun.mock.calls[0]![0].jobId],
    [mocks.cloneRun.mock.calls[0]![0].jobId],
  ]);
  pending.reject({ code: "cancelled" });
  await flushPromises();
  expect(mocks.close).toHaveBeenCalledWith(null, 23);
});

it("backs off pending cancellation and stops retries after an unmounted clone settles", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  mocks.jobCancel.mockResolvedValue(false);
  const wrapper = await start();
  wrapper.unmount();
  await flushPromises();
  await vi.advanceTimersByTimeAsync(2000);
  expect(mocks.jobCancel.mock.calls.length).toBeLessThanOrEqual(8);
  expect(mocks.jobCancel.mock.calls.length).toBeGreaterThan(1);
  pending.reject({ code: "cancelled" });
  await flushPromises();
  const count = mocks.jobCancel.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.jobCancel).toHaveBeenCalledTimes(count);
  expect(mocks.close).not.toHaveBeenCalled();
});

it("honors the open-after checkbox and validates whole positive depths", async () => {
  mocks.cloneRun.mockResolvedValue({ path: "C:/qa/clone" });
  const wrapper = mount(CloneDialog);
  await wrapper.get("#clone-url").setValue("https://example.test/repo");
  await wrapper.get("#clone-directory").setValue("C:/qa/clone");
  const checkboxes = wrapper.findAll('input[type="checkbox"]');
  await checkboxes[0]!.setValue(true);
  await checkboxes[1]!.setValue(false);
  await wrapper.get('input[type="number"]').setValue(1.5);
  await submit(wrapper);
  expect(mocks.cloneRun).not.toHaveBeenCalled();
  await wrapper.get('input[type="number"]').setValue(2);
  await submit(wrapper);
  await flushPromises();
  expect(mocks.cloneRun.mock.calls[0]![0]).toMatchObject({ depth: 2, openAfter: false });
  expect(mocks.close).toHaveBeenCalledWith(null, 23);
});

it("does not treat composing Escape as a cancellation", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  const wrapper = await start();
  await wrapper.get("form").trigger("keydown", { key: "Escape", isComposing: true });
  expect(mocks.jobCancel).not.toHaveBeenCalled();
  await wrapper.get("form").trigger("keydown", { key: "Escape" });
  expect(mocks.jobCancel).toHaveBeenCalledTimes(1);
  pending.reject({ code: "cancelled" });
  await flushPromises();
});
