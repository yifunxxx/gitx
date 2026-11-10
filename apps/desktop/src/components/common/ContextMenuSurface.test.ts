import { afterEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import ContextMenuSurface from "./ContextMenuSurface.vue";
import DialogHost from "./DialogHost.vue";
import { closeDialog, openDialog } from "@/composables/useDialog";

enableAutoUnmount(afterEach);
afterEach(() => {
  document.body.innerHTML = "";
});

function key(key: string, options: KeyboardEventInit = {}, target = document.activeElement!) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
async function fixture(
  slot = '<button role="menuitem" id="first">First</button><button role="menuitem" disabled>Disabled</button><button role="menuitem" id="last">Last</button>',
) {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const menu = mount(ContextMenuSurface, {
    props: { open: false, anchorX: 10, anchorY: 10, label: "Actions" },
    slots: { default: slot },
    attachTo: document.body,
  });
  await menu.setProps({ open: true });
  await flushPromises();
  const panel = () => document.querySelector<HTMLElement>('[role="menu"]')!;
  return { menu, opener, panel };
}

it("focuses enabled items and cycles with arrows, Home and End", async () => {
  const { panel } = await fixture();
  expect(panel().getAttribute("aria-label")).toBe("Actions");
  expect(document.activeElement?.id).toBe("first");
  key("ArrowUp");
  expect(document.activeElement?.id).toBe("last");
  key("ArrowDown");
  expect(document.activeElement?.id).toBe("first");
  key("End");
  expect(document.activeElement?.id).toBe("last");
  key("Home");
  expect(document.activeElement?.id).toBe("first");
  panel().focus();
  key("ArrowUp");
  expect(document.activeElement?.id).toBe("last");
});

it.each(["Escape", "Tab"])("closes on %s and restores its opener", async (shortcut) => {
  const { menu, opener } = await fixture();
  expect(key(shortcut).defaultPrevented).toBe(true);
  expect(menu.emitted("close")).toHaveLength(1);
  await menu.setProps({ open: false });
  expect(document.activeElement).toBe(opener);
});

it("closes on Shift+Tab but ignores modified navigation and composition", async () => {
  const { menu } = await fixture();
  for (const modifier of ["ctrlKey", "altKey", "metaKey", "shiftKey", "isComposing"]) {
    for (const shortcut of ["ArrowDown", "End", "Escape"]) {
      const event = key(shortcut, { [modifier]: true });
      if (modifier !== "isComposing" && shortcut !== "Escape")
        expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement?.id).toBe("first");
      expect(menu.emitted("close")).toBeUndefined();
    }
  }
  key("Tab", { shiftKey: true });
  expect(menu.emitted("close")).toHaveLength(1);
});

it("activates once with Enter or Space, suppressing held and modified activation", async () => {
  await fixture();
  const clicked = vi.fn();
  const item = document.getElementById("first")!;
  item.addEventListener("click", clicked);
  for (const shortcut of ["Enter", " "]) {
    item.focus();
    expect(key(shortcut, {}, item).defaultPrevented).toBe(true);
    item.focus();
    key(shortcut, { repeat: true }, item);
    for (const modifier of ["ctrlKey", "altKey", "metaKey", "shiftKey", "isComposing"]) {
      item.focus();
      key(shortcut, { [modifier]: true }, item);
    }
  }
  expect(clicked).toHaveBeenCalledTimes(2);
});

it("keeps menu keys local without intercepting another input or dialog", async () => {
  const { menu } = await fixture();
  const globalKey = vi.fn();
  window.addEventListener("keydown", globalKey);
  try {
    key("ArrowDown");
    key("Delete");
    expect(globalKey).not.toHaveBeenCalled();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const event = key("ArrowDown");
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(globalKey).toHaveBeenCalledOnce();
    await menu.setProps({ open: false });
    expect(document.activeElement).toBe(input);
  } finally {
    window.removeEventListener("keydown", globalKey);
  }
});

it("does not navigate while editing an input within the panel", async () => {
  await fixture('<input id="filter" /><button role="menuitem" id="first">First</button>');
  const input = document.getElementById("filter")!;
  input.focus();
  const event = key("Home");
  expect(event.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
});

it("leaves nested dialog input and Escape to the dialog", async () => {
  const { menu } = await fixture(
    '<div role="dialog"><input id="nested-input" /></div><button role="menuitem" id="first">First</button>',
  );
  const input = document.getElementById("nested-input")!;
  input.focus();
  expect(key("Home").defaultPrevented).toBe(false);
  expect(key("Escape").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(menu.emitted("close")).toBeUndefined();
});

it("recovers focus when an active command becomes disabled", async () => {
  await fixture();
  (document.getElementById("first") as HTMLButtonElement).disabled = true;
  await vi.waitFor(() => expect(document.activeElement?.id).toBe("last"));
});

it("skips hidden and aria-disabled items and recovers when the active item disappears", async () => {
  await fixture(
    '<button role="menuitem" id="first">First</button><div hidden><button role="menuitem">Hidden</button></div><button role="menuitem" aria-disabled="true">Unavailable</button><button role="menuitem" id="last">Last</button>',
  );
  key("ArrowDown");
  expect(document.activeElement?.id).toBe("last");
  document.getElementById("last")!.remove();
  await vi.waitFor(() => expect(document.activeElement?.id).toBe("first"));
});

it("keeps an all-disabled menu focusable and navigates when an action becomes enabled", async () => {
  const { panel } = await fixture('<button role="menuitem" disabled id="first">First</button>');
  expect(document.activeElement).toBe(panel());
  (document.getElementById("first") as HTMLButtonElement).disabled = false;
  await flushPromises();
  key("ArrowDown");
  expect(document.activeElement?.id).toBe("first");
});

it("restores focus on unmount and leaves no keyboard handler behind", async () => {
  const { menu, opener } = await fixture();
  menu.unmount();
  expect(document.activeElement).toBe(opener);
  expect(key("Escape").defaultPrevented).toBe(false);
});

it("does not focus after unmount during opening", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const menu = mount(ContextMenuSurface, {
    props: { open: true, anchorX: 0, anchorY: 0 },
    slots: { default: '<button role="menuitem">Action</button>' },
    attachTo: document.body,
  });
  menu.unmount();
  await flushPromises();
  expect(document.activeElement).toBe(opener);
});

it("lets an action open a dialog and restores the original opener when that dialog closes", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const opened = ref(true);
  const Dialog = defineComponent({
    template: '<div role="dialog"><input id="dialog-input" /></div>',
  });
  mount(
    defineComponent({
      setup: () => () => [
        h(DialogHost),
        h(
          ContextMenuSurface,
          {
            open: opened.value,
            anchorX: 0,
            anchorY: 0,
            onClose: () => {
              opened.value = false;
            },
          },
          {
            default: () =>
              h(
                "button",
                {
                  role: "menuitem",
                  onClick: () => {
                    opened.value = false;
                    void openDialog(Dialog);
                  },
                },
                "Open dialog",
              ),
          },
        ),
      ],
    }),
    { attachTo: document.body },
  );
  await flushPromises();
  key("Enter");
  await flushPromises();
  expect(document.activeElement?.id).toBe("dialog-input");
  expect(key("Home").defaultPrevented).toBe(false);
  closeDialog(null);
  await nextTick();
  await nextTick();
  expect(document.activeElement).toBe(opener);
});
