import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import DialogHost from "@/components/common/DialogHost.vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import CredentialDialog, {
  type CredentialDialogResult,
} from "@/features/sync/CredentialDialog.vue";
import { closeDialog, openDialog, useDialogState, useDialogStack } from "@/composables/useDialog";
import CloneDialog from "./CloneDialog.vue";

const mocks = vi.hoisted(() => ({
  cloneRun: vi.fn(),
  cloneCheckUrl: vi.fn(),
  jobCancel: vi.fn(),
  auth: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("@/lib/utils", async (original) => ({ ...(await original<any>()), isTauri: () => false }));
vi.mock("@/composables/useCredentials", () => ({ handleAuthFailure: mocks.auth }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({ settings: null }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let host: ReturnType<typeof mount>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.jobCancel.mockResolvedValue(true);
  host = mount(DialogHost, { attachTo: document.body });
});
afterEach(() => {
  host.unmount();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.body.removeAttribute("tabindex");
});

function focusBody() {
  document.body.tabIndex = -1;
  document.body.focus();
  expect(document.activeElement).toBe(document.body);
}

async function start(moveFocusToBody = true) {
  const result = openDialog(CloneDialog);
  await nextTick();
  await nextTick();
  const cloneId = useDialogState().value!.id;
  await host.get("#clone-url").setValue("https://example.test/repo.git");
  await host.get("#clone-directory").setValue("C:/qa/clone");
  const submit = host.get<HTMLButtonElement>('button[type="submit"]');
  submit.element.focus();
  await host.get("form").trigger("submit");
  expect(submit.element.disabled).toBe(true);
  // WebView drops focus from the just-disabled Clone button to the document.
  // Explicitly recreate that target; synthetic form keydown misses this case.
  if (moveFocusToBody) focusBody();
  return { result, cloneId };
}

function escape(target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

it.each(["body", "document"] as const)(
  "cancels a busy clone when focus has returned to %s",
  async (target) => {
    const pending = deferred<{ path: string }>();
    mocks.cloneRun.mockReturnValue(pending.promise);
    const { result, cloneId } = await start();
    const event = escape(target === "body" ? document.body : document);
    expect(mocks.jobCancel).toHaveBeenCalledExactlyOnceWith(mocks.cloneRun.mock.calls[0]![0].jobId);
    expect(event.defaultPrevented).toBe(true);
    expect(useDialogState().value?.id).toBe(cloneId);
    await nextTick();
    expect(host.get('[role="status"]').text()).toBe("clone.cancelling");
    pending.reject({ code: "cancelled" });
    await flushPromises();
    expect(await result).toBeNull();
    expect(useDialogStack().value).toHaveLength(0);
    expect(mocks.toast).not.toHaveBeenCalled();
  },
);

it("moves focus from the disabled submit button to Cancel while cloning", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  const { result } = await start(false);
  await nextTick();
  const cancel = host.findAll("button").find((button) => button.text() === "clone.cancel")!;
  expect(document.activeElement).toBe(cancel.element);
  escape(document.activeElement!);
  expect(mocks.jobCancel).toHaveBeenCalledTimes(1);
  pending.reject({ code: "cancelled" });
  await flushPromises();
  expect(await result).toBeNull();
});

it("does not duplicate a cancellation from the overlay or repeated document Escape", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  const { result } = await start();
  escape(host.get("form").element);
  escape();
  escape(document, { repeat: true });
  expect(mocks.jobCancel).toHaveBeenCalledTimes(1);
  pending.reject({ code: "cancelled" });
  await flushPromises();
  expect(await result).toBeNull();
});

it("ignores composition, repeated keys and already-handled document Escape", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  const { result } = await start();
  escape(document, { isComposing: true });
  escape(document, { keyCode: 229 });
  escape(document, { repeat: true });
  const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  handled.preventDefault();
  document.body.dispatchEvent(handled);
  expect(mocks.jobCancel).not.toHaveBeenCalled();
  escape();
  expect(mocks.jobCancel).toHaveBeenCalledTimes(1);
  pending.reject({ code: "cancelled" });
  await flushPromises();
  expect(await result).toBeNull();
});

it("preserves a busy parent while a confirmation owns Escape, including focus outside its panel", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  const { result, cloneId } = await start();
  const confirmation = openDialog(ConfirmDialog, {
    title: "Nested confirmation",
    message: "Keep waiting?",
  });
  await nextTick();
  await nextTick();
  const confirmationId = useDialogState().value!.id;
  focusBody();
  const outside = escape();
  expect(outside.defaultPrevented).toBe(false);
  expect(useDialogState().value?.id).toBe(confirmationId);
  expect(mocks.jobCancel).not.toHaveBeenCalled();
  escape(host.get(`[data-dialog-host="${confirmationId}"] button`).element);
  expect(await confirmation).toBe(false);
  expect(useDialogState().value?.id).toBe(cloneId);
  expect(mocks.jobCancel).not.toHaveBeenCalled();
  await nextTick();
  escape();
  expect(mocks.jobCancel).toHaveBeenCalledTimes(1);
  pending.reject({ code: "cancelled" });
  await flushPromises();
  expect(await result).toBeNull();
});

it("lets a credential dialog consume Escape without cancelling or dismissing its clone parent", async () => {
  const authError = new Error("Authentication required");
  mocks.cloneRun.mockRejectedValueOnce(authError);
  mocks.auth.mockImplementation(async () => {
    const credentials = await openDialog<CredentialDialogResult>(CredentialDialog);
    return !!credentials?.retry;
  });
  const { result, cloneId } = await start();
  await flushPromises();
  const credentialId = useDialogState().value!.id;
  expect(credentialId).not.toBe(cloneId);
  escape(document);
  expect(useDialogState().value?.id).toBe(credentialId);
  expect(mocks.jobCancel).not.toHaveBeenCalled();
  escape(host.get(`[data-dialog-host="${credentialId}"] input`).element);
  await flushPromises();
  expect(useDialogState().value?.id).toBe(cloneId);
  expect(mocks.cloneRun).toHaveBeenCalledTimes(1);
  expect(mocks.jobCancel).not.toHaveBeenCalled();
  expect(host.get('[role="alert"]').text()).toContain("Authentication required");
  expect(host.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(false);
  escape();
  expect(await result).toBeNull();
});

it("ignores a closed clone before Vue unmounts it and removes its document listener on unmount", async () => {
  const add = vi.spyOn(document, "addEventListener");
  const remove = vi.spyOn(document, "removeEventListener");
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  const { result, cloneId } = await start();
  const listener = add.mock.calls.find(([type]) => type === "keydown")?.[1];
  expect(listener).toBeTypeOf("function");
  closeDialog(null, cloneId);
  expect(escape().defaultPrevented).toBe(false);
  expect(mocks.jobCancel).not.toHaveBeenCalled();
  await nextTick();
  expect(remove).toHaveBeenCalledWith("keydown", listener);
  expect(mocks.jobCancel).toHaveBeenCalledTimes(1); // Existing unmount cancellation.
  expect(escape().defaultPrevented).toBe(false);
  expect(mocks.jobCancel).toHaveBeenCalledTimes(1);
  pending.reject({ code: "cancelled" });
  await flushPromises();
  expect(await result).toBeNull();
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("allows a new Escape after a cancellation error while ignoring auto-repeat", async () => {
  const pending = deferred<{ path: string }>();
  mocks.cloneRun.mockReturnValue(pending.promise);
  mocks.jobCancel.mockRejectedValueOnce(new Error("Cancel failed")).mockResolvedValue(true);
  const { result } = await start();
  escape();
  await flushPromises();
  expect(host.get('[role="alert"]').text()).toContain("Cancel failed");
  escape(document, { repeat: true });
  expect(mocks.jobCancel).toHaveBeenCalledTimes(1);
  escape();
  expect(mocks.jobCancel).toHaveBeenCalledTimes(2);
  pending.reject({ code: "cancelled" });
  await flushPromises();
  expect(await result).toBeNull();
});
