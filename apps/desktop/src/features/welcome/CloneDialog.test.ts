import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
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
afterEach(() => vi.useRealTimers());

async function start() {
  const wrapper = mount(CloneDialog);
  await wrapper.get("#clone-url").setValue("https://example.test/repo.git");
  await wrapper.get("#clone-directory").setValue("C:/qa/clone");
  await wrapper.get("form").trigger("submit");
  return wrapper;
}
const cancelButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll("button").find((b) => b.text() === "clone.cancel")!;

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
  await wrapper.get("form").trigger("submit");
  expect(mocks.cloneRun).toHaveBeenCalledTimes(2);
  const [first, second] = mocks.cloneRun.mock.calls;
  expect(second![0].jobId).not.toBe(first![0].jobId);
  await cancelButton(wrapper).trigger("click");
  expect(mocks.jobCancel).toHaveBeenCalledWith(second![0].jobId);
  pending.reject({ code: "cancelled" });
  await flushPromises();
  wrapper.unmount();
});
