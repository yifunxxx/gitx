import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import DialogHost from "./DialogHost.vue";
import PromptDialog from "./PromptDialog.vue";
import CredentialDialog from "@/features/sync/CredentialDialog.vue";
import { openDialog, useDialogState } from "@/composables/useDialog";
import { promptCredentials } from "@/composables/useCredentials";

const persistence = vi.hoisted(() => ({
  set: vi.fn(async (_args: unknown) => ({ storedHelper: true })),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({ settings: null }) }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ credentialSessionSet: persistence.set }) }));
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: () => ({ repoPath: "C:/qa-synthetic-repo" }),
}));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ remotes: [] }) }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));

const ignoredEnterCases = [
  { name: "IME composition", init: { isComposing: true } },
  { name: "IME keyCode 229", init: { keyCode: 229 } },
  { name: "already-handled Enter", init: {}, handled: true },
  { name: "auto-repeated Enter", init: { repeat: true } },
] satisfies { name: string; init: KeyboardEventInit; handled?: boolean }[];

const dialogs = [
  { name: "prompt", component: PromptDialog, props: { title: "Synthetic QA prompt" } },
  { name: "credentials", component: CredentialDialog, props: {} },
] as const;
const fields = [
  { name: "prompt text", kind: dialogs[0], selector: 'input[type="text"]' },
  { name: "credential username", kind: dialogs[1], selector: 'input[type="text"]' },
  { name: "credential password", kind: dialogs[1], selector: 'input[type="password"]' },
];

let host: ReturnType<typeof mount>;
beforeEach(() => {
  persistence.set.mockClear();
  host = mount(DialogHost, { attachTo: document.body });
});
afterEach(() => {
  host.unmount();
  document.body.innerHTML = "";
});

async function open(
  kind: (typeof dialogs)[number],
  fill = true,
  props: Record<string, unknown> = {},
) {
  const settled = vi.fn();
  const result = openDialog(kind.component, { ...kind.props, ...props });
  void result.then(settled);
  await nextTick();
  await nextTick();
  const id = useDialogState().value!.id;
  const panel = host.get(`[data-dialog-host="${id}"]`);
  const input = panel.get<HTMLInputElement>('input[type="text"]');
  if (fill) await input.setValue("qa-user-draft");
  if (fill && kind.name === "credentials") {
    await panel.get<HTMLInputElement>('input[type="password"]').setValue("qa-fake-password");
  }
  return { id, panel, input, result, settled };
}

function enter(target: EventTarget, init: KeyboardEventInit = {}, handled = false) {
  if (handled)
    // Run before the input's own bubble listener so the event is already handled.
    target.addEventListener("keydown", (event) => event.preventDefault(), {
      once: true,
      capture: true,
    });
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function expectedResult(kind: (typeof dialogs)[number]) {
  return kind.name === "prompt"
    ? "qa-user-draft"
    : { username: "qa-user-draft", password: "qa-fake-password", storeHelper: true, retry: true };
}

for (const field of fields) {
  describe(`${field.name} Enter`, () => {
    it.each(ignoredEnterCases)(
      "preserves the dialog and draft for $name",
      async ({ init, handled }) => {
        const dialog = await open(field.kind);
        const input = dialog.panel.get<HTMLInputElement>(field.selector);
        const draft = input.element.value;
        const event = enter(input.element, init, handled);
        await flushPromises();
        expect(useDialogState().value?.id).toBe(dialog.id);
        expect(dialog.settled).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(handled ?? false);
        expect(input.element.isConnected).toBe(true);
        expect(input.element.value).toBe(draft);
      },
    );

    it("submits once on a fresh Enter from the input", async () => {
      const dialog = await open(field.kind);
      const event = enter(dialog.panel.get(field.selector).element);
      await flushPromises();
      expect(event.defaultPrevented).toBe(true);
      expect(dialog.settled).toHaveBeenCalledExactlyOnceWith(expectedResult(field.kind));
      expect(await dialog.result).toEqual(expectedResult(field.kind));
    });
  });
}

for (const kind of dialogs) {
  describe(`${kind.name} input and button defaults`, () => {
    it.each([{ isComposing: true }, { keyCode: 229 }])(
      "keeps IME default handling with empty fields for %j",
      async (init) => {
        const dialog = await open(kind, false);
        const event = enter(dialog.input.element, init);
        await flushPromises();
        expect(event.defaultPrevented).toBe(false);
        expect(useDialogState().value?.id).toBe(dialog.id);
        expect(dialog.settled).not.toHaveBeenCalled();
      },
    );

    it.each(["cancel", "submit"] as const)(
      "leaves Enter on the %s button to its native activation",
      async (action) => {
        const dialog = await open(kind);
        const buttons = dialog.panel.findAll("button");
        const button = action === "cancel" ? buttons[0]! : buttons[1]!;
        for (const repeat of [false, true]) {
          const event = enter(button.element, { repeat });
          await flushPromises();
          expect(event.defaultPrevented).toBe(false);
          expect(dialog.settled).not.toHaveBeenCalled();
        }
        // Synthetic keydown does not invoke a trusted browser's default click.
        // Verify non-interception above and the explicit click action separately.
        await button.trigger("click");
        expect(await dialog.result).toEqual(action === "cancel" ? null : expectedResult(kind));
      },
    );
  });
}

it("does not intercept credential helper checkbox Enter as a submit", async () => {
  const dialog = await open(dialogs[1]);
  const checkbox = dialog.panel.get<HTMLInputElement>('input[type="checkbox"]');
  const checked = checkbox.element.checked;
  const event = enter(checkbox.element);
  await flushPromises();
  expect(event.defaultPrevented).toBe(false);
  expect(dialog.settled).not.toHaveBeenCalled();
  expect(checkbox.element.checked).toBe(checked);
  await checkbox.setValue(false);
  enter(dialog.panel.get('input[type="password"]').element);
  expect(await dialog.result).toEqual({
    username: "qa-user-draft",
    password: "qa-fake-password",
    storeHelper: false,
    retry: true,
  });
});

it.each(["", "   "])("does not submit a required prompt containing %j", async (value) => {
  const dialog = await open(dialogs[0], false, { allowEmpty: false });
  await dialog.input.setValue(value);
  const event = enter(dialog.input.element);
  await flushPromises();
  expect(event.defaultPrevented).toBe(false);
  expect(dialog.settled).not.toHaveBeenCalled();
  await dialog.panel.findAll("button")[1]!.trigger("click");
  expect(useDialogState().value?.id).toBe(dialog.id);
  await dialog.input.setValue("valid prompt");
  enter(dialog.input.element);
  expect(await dialog.result).toBe("valid prompt");
});

it("preserves the prompt's explicit allow-empty behavior for ordinary Enter", async () => {
  const dialog = await open(dialogs[0], false);
  const event = enter(dialog.input.element);
  expect(event.defaultPrevented).toBe(true);
  expect(await dialog.result).toBe("");
});

it.each([
  { username: "", password: "qa-fake-password" },
  { username: "   ", password: "qa-fake-password" },
  { username: "qa-user-draft", password: "" },
])("does not submit incomplete credentials %j", async (value) => {
  const dialog = await open(dialogs[1], false);
  const password = dialog.panel.get<HTMLInputElement>('input[type="password"]');
  await dialog.input.setValue(value.username);
  await password.setValue(value.password);
  const event = enter(password.element);
  await flushPromises();
  expect(event.defaultPrevented).toBe(false);
  expect(dialog.settled).not.toHaveBeenCalled();
  expect(dialog.panel.findAll("button")[1]!.attributes("disabled")).toBeDefined();
  await dialog.input.setValue(" qa-user-draft ");
  await password.setValue("qa-fake-password");
  enter(password.element);
  expect(await dialog.result).toEqual(expectedResult(dialogs[1]));
});

describe("credential persistence boundary with a stub backend", () => {
  it.each(["IME Enter", "Cancel-button Enter"])(
    "does not save or retry for %s",
    async (scenario) => {
      const settled = vi.fn();
      const request = promptCredentials({ url: "https://example.invalid/repo.git" });
      void request.then(settled);
      await nextTick();
      await nextTick();
      await host.get<HTMLInputElement>('input[type="text"]').setValue("qa-user-draft");
      await host.get<HTMLInputElement>('input[type="password"]').setValue("qa-fake-password");
      const target =
        scenario === "IME Enter"
          ? host.get('input[type="text"]').element
          : host.get("button").element;
      enter(target, scenario === "IME Enter" ? { isComposing: true } : {});
      await flushPromises();
      expect(persistence.set).not.toHaveBeenCalled();
      expect(settled).not.toHaveBeenCalled();
      await host.get("button").trigger("click");
      expect(await request).toBe(false);
      expect(persistence.set).not.toHaveBeenCalled();
    },
  );

  it("saves once and requests retry after ordinary password Enter", async () => {
    const request = promptCredentials({ url: "https://example.invalid/repo.git" });
    await nextTick();
    await nextTick();
    await host.get<HTMLInputElement>('input[type="text"]').setValue("qa-user-draft");
    await host.get<HTMLInputElement>('input[type="password"]').setValue("qa-fake-password");
    enter(host.get('input[type="password"]').element);
    expect(await request).toBe(true);
    expect(persistence.set).toHaveBeenCalledExactlyOnceWith({
      path: "C:/qa-synthetic-repo",
      protocol: "https",
      host: "example.invalid",
      username: "qa-user-draft",
      password: "qa-fake-password",
      storeHelper: true,
      url: "https://example.invalid/repo.git",
    });
  });
});
