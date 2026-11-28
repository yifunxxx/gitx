import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import CustomContextMenuHost from "./CustomContextMenuHost.vue";

const mocks = vi.hoisted(() => ({ ws: {} as any, changes: {} as any, run: vi.fn() }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/actions/titles", () => ({ resolveActionTitle: () => "Stage" }));
vi.mock("@/actions", () => ({
  getGroup: () => ({ children: ["stage"] }),
  getAction: () => ({ id: "stage" }),
  runAction: mocks.run,
  shortcutFor: () => [],
  isEnabled: () => true,
  isVisible: () => true,
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
let wrapper: ReturnType<typeof mount>;
let surface: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ws = reactive({
    repoPath: "A",
    repoId: "A",
    folderPath: "A",
    isRepo: true,
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  });
  mocks.changes = reactive({
    selectedPaths: ["first.txt"],
    selectedSection: "unstaged",
    stagingMode: true,
  });
  surface = document.createElement("div");
  surface.dataset.gitxContext = "changes";
  document.body.append(surface);
  wrapper = mount(CustomContextMenuHost, { attachTo: document.body });
});
afterEach(() => {
  wrapper.unmount();
  surface.remove();
});
async function openMenu() {
  surface.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await flushPromises();
  return document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
}
it("dispatches the context's files and repository", async () => {
  (await openMenu()).click();
  expect(mocks.run).toHaveBeenCalledWith(
    "stage",
    expect.objectContaining({
      repoIds: ["A"],
      selection: { files: ["first.txt"] },
    }),
  );
});

it("preserves the action's checked-file fallback when the context has no selected files", async () => {
  mocks.changes.selectedPaths = [];
  (await openMenu()).click();
  expect(mocks.run).toHaveBeenCalledWith(
    "stage",
    expect.objectContaining({
      selection: { files: undefined },
    }),
  );
});
it.each(["navigation", "selection"])("closes on %s and ignores a queued click", async (kind) => {
  const button = await openMenu();
  if (kind === "navigation") mocks.ws.generation++;
  else mocks.changes.selectedPaths.push("other.txt");
  button.click();
  await flushPromises();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each(["textarea", "input", "readonly", "password", "editable", "plaintext", "inherited"])(
  "leaves a %s text control to its native editing menu instead of Git actions",
  async (kind) => {
    const control = document.createElement(
      kind === "textarea" || kind === "readonly"
        ? "textarea"
        : kind === "input" || kind === "password"
          ? "input"
          : "div",
    );
    if (control instanceof HTMLInputElement)
      control.type = kind === "password" ? "password" : "text";
    if (control instanceof HTMLTextAreaElement) {
      control.value = "Commit message";
      control.readOnly = kind === "readonly";
    }
    if (["editable", "plaintext", "inherited"].includes(kind))
      control.setAttribute("contenteditable", kind === "plaintext" ? "plaintext-only" : "true");
    let target: HTMLElement = control;
    if (kind === "inherited") {
      target = document.createElement("span");
      control.append(target);
    }
    surface.append(control);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(mocks.run).not.toHaveBeenCalled();
  },
);

it("preserves text input routing outside the Changes surface and closes an old menu", async () => {
  await openMenu();
  const input = document.createElement("input");
  document.body.append(input);
  try {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  } finally {
    input.remove();
  }
});

it("does not replace a component-owned menu when its event is already prevented", async () => {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  event.preventDefault();
  surface.dispatchEvent(event);
  await flushPromises();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each(["checkbox", "button", "noneditable"])(
  "keeps the Changes menu for a non-text %s control",
  async (kind) => {
    const control = document.createElement(kind === "noneditable" ? "div" : "input");
    if (control instanceof HTMLInputElement) control.type = kind;
    else control.setAttribute("contenteditable", "false");
    surface.append(control);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    control.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="menuitem"]')?.textContent).toContain("Stage");
  },
);
