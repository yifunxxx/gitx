import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import DialogHost from "./DialogHost.vue";
import PromptDialog from "./PromptDialog.vue";
import CredentialDialog, {
  type CredentialDialogResult,
} from "@/features/sync/CredentialDialog.vue";
import { closeDialog, openDialog, useDialogStack, useDialogState } from "@/composables/useDialog";

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({ settings: null }) }));

const Parent = defineComponent({
  setup: () => ({ draft: ref("unfinished parent draft") }),
  template: '<div role="dialog"><input id="parent-draft" v-model="draft" /></div>',
});

const ignoredEscapeCases = [
  { name: "an active IME composition", init: { isComposing: true } },
  { name: "the IME keyCode 229 fallback", init: { keyCode: 229 } },
  { name: "an Escape already handled by the input", init: {}, handled: true },
  { name: "an auto-repeated Escape", init: { repeat: true } },
] satisfies { name: string; init: KeyboardEventInit; handled?: boolean }[];

let host: ReturnType<typeof mount>;
beforeEach(() => {
  host = mount(DialogHost, { attachTo: document.body });
});
afterEach(() => {
  host.unmount();
  document.body.innerHTML = "";
});

function escape(target: EventTarget, init: KeyboardEventInit = {}, handled = false) {
  if (handled)
    target.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

async function openParent() {
  const result = openDialog(Parent);
  await nextTick();
  await nextTick();
  return { result, id: useDialogState().value!.id };
}

describe("real nested dialog Escape routing", () => {
  it.each(ignoredEscapeCases)(
    "keeps a confirmation open during $name",
    async ({ init, handled }) => {
      const parent = await openParent();
      const settled = vi.fn();
      const result = openDialog<boolean>(ConfirmDialog, {
        title: "Confirmation",
        message: "Discard the draft?",
      });
      void result.then(settled);
      await nextTick();
      await nextTick();
      const id = useDialogState().value!.id;
      const cancel = host.get(`[data-dialog-host="${id}"] button`);

      const ignored = escape(cancel.element, init, handled);
      expect(ignored.defaultPrevented).toBe(handled ?? false);
      await flushPromises();
      expect(useDialogState().value?.id).toBe(id);
      expect(settled).not.toHaveBeenCalled();
      expect(useDialogStack().value).toHaveLength(2);

      const event = escape(cancel.element);
      expect(event.defaultPrevented).toBe(true);
      expect(await result).toBe(false);
      await flushPromises();
      expect(settled).toHaveBeenCalledExactlyOnceWith(false);
      expect(useDialogState().value?.id).toBe(parent.id);
      expect(host.get<HTMLInputElement>("#parent-draft").element.value).toBe(
        "unfinished parent draft",
      );
      closeDialog(null, parent.id);
      expect(await parent.result).toBeNull();
    },
  );

  it.each(ignoredEscapeCases)(
    "preserves the credential draft during $name",
    async ({ init, handled }) => {
      const parent = await openParent();
      const settled = vi.fn();
      const result = openDialog<CredentialDialogResult>(CredentialDialog);
      void result.then(settled);
      await nextTick();
      await nextTick();
      const id = useDialogState().value!.id;
      const username = host.get<HTMLInputElement>(`[data-dialog-host="${id}"] input[type="text"]`);
      const password = host.get<HTMLInputElement>(
        `[data-dialog-host="${id}"] input[type="password"]`,
      );
      await username.setValue("qa-user");
      await password.setValue("qa-only-draft");

      const ignored = escape(password.element, init, handled);
      expect(ignored.defaultPrevented).toBe(handled ?? false);
      await flushPromises();
      expect(useDialogState().value?.id).toBe(id);
      expect(settled).not.toHaveBeenCalled();
      expect(useDialogStack().value).toHaveLength(2);
      expect(username.element.isConnected).toBe(true);
      expect(username.element.value).toBe("qa-user");
      expect(password.element.value).toBe("qa-only-draft");

      const event = escape(password.element);
      expect(event.defaultPrevented).toBe(true);
      expect(await result).toBeNull();
      await flushPromises();
      expect(settled).toHaveBeenCalledExactlyOnceWith(null);
      expect(useDialogState().value?.id).toBe(parent.id);
      expect(host.get<HTMLInputElement>("#parent-draft").element.value).toBe(
        "unfinished parent draft",
      );
      closeDialog(null, parent.id);
      expect(await parent.result).toBeNull();
    },
  );

  it.each(ignoredEscapeCases)(
    "preserves the prompt draft during $name",
    async ({ init, handled }) => {
      const parent = await openParent();
      const settled = vi.fn();
      const result = openDialog<string | null>(PromptDialog, { title: "Name the draft" });
      void result.then(settled);
      await nextTick();
      await nextTick();
      const id = useDialogState().value!.id;
      const input = host.get<HTMLInputElement>(`[data-dialog-host="${id}"] input`);
      await input.setValue("unfinished prompt draft");

      const ignored = escape(input.element, init, handled);
      await flushPromises();
      expect(useDialogState().value?.id).toBe(id);
      expect(ignored.defaultPrevented).toBe(handled ?? false);
      expect(settled).not.toHaveBeenCalled();
      expect(useDialogStack().value).toHaveLength(2);
      expect(input.element.isConnected).toBe(true);
      expect(input.element.value).toBe("unfinished prompt draft");

      const event = escape(input.element);
      expect(event.defaultPrevented).toBe(true);
      expect(await result).toBeNull();
      await flushPromises();
      expect(settled).toHaveBeenCalledExactlyOnceWith(null);
      expect(useDialogState().value?.id).toBe(parent.id);
      expect(host.get<HTMLInputElement>("#parent-draft").element.value).toBe(
        "unfinished parent draft",
      );
      closeDialog(null, parent.id);
      expect(await parent.result).toBeNull();
    },
  );

  it.each(ignoredEscapeCases)(
    "keeps an unhandled dialog open during $name",
    async ({ init, handled }) => {
      const parent = await openParent();
      const result = openDialog(defineComponent({ template: '<input id="host-owned-input" />' }));
      await nextTick();
      await nextTick();
      const id = useDialogState().value!.id;
      const input = host.get("#host-owned-input");

      const ignored = escape(input.element, init, handled);
      expect(ignored.defaultPrevented).toBe(handled ?? false);
      await nextTick();
      expect(useDialogState().value?.id).toBe(id);
      expect(useDialogStack().value).toHaveLength(2);

      escape(input.element);
      expect(await result).toBeNull();
      expect(useDialogState().value?.id).toBe(parent.id);
      closeDialog(null, parent.id);
      expect(await parent.result).toBeNull();
    },
  );

  it.each([
    {
      name: "confirmation",
      component: ConfirmDialog,
      props: { title: "Parent confirmation", message: "Keep this parent open?" },
      target: "button",
      cancelled: false,
    },
    {
      name: "credentials",
      component: CredentialDialog,
      props: {},
      target: 'input[type="text"]',
      cancelled: null,
    },
    {
      name: "prompt",
      component: PromptDialog,
      props: { title: "Parent prompt" },
      target: "input",
      cancelled: null,
    },
    {
      name: "host-owned",
      component: Parent,
      props: {},
      target: "input",
      cancelled: null,
    },
  ])(
    "does not close a $name parent when holding Escape after dismissing a child",
    async ({ component, props, target, cancelled }) => {
      const settled = vi.fn();
      const result = openDialog(component, props);
      void result.then(settled);
      await nextTick();
      await nextTick();
      const parentId = useDialogState().value!.id;
      const parentInput = host.get<HTMLElement>(`[data-dialog-host="${parentId}"] ${target}`);
      if (parentInput.element instanceof HTMLInputElement) {
        await parentInput.setValue("parent draft survives a held key");
      }
      parentInput.element.focus();

      const child = openDialog<boolean>(ConfirmDialog, {
        title: "Child confirmation",
        message: "Close only this child?",
      });
      await nextTick();
      await nextTick();
      const childId = useDialogState().value!.id;
      escape(host.get(`[data-dialog-host="${childId}"] button`).element);
      expect(await child).toBe(false);
      await flushPromises();
      expect(useDialogState().value?.id).toBe(parentId);
      expect(document.activeElement).toBe(parentInput.element);

      const repeated = escape(document.activeElement!, { repeat: true });
      await flushPromises();
      expect(useDialogState().value?.id).toBe(parentId);
      expect(repeated.defaultPrevented).toBe(false);
      expect(settled).not.toHaveBeenCalled();
      expect(parentInput.element.isConnected).toBe(true);
      if (parentInput.element instanceof HTMLInputElement) {
        expect(parentInput.element.value).toBe("parent draft survives a held key");
      }

      escape(parentInput.element);
      expect(await result).toBe(cancelled);
      expect(useDialogStack().value).toHaveLength(0);
    },
  );
});
