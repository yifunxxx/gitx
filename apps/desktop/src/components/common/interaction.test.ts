import { afterEach, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import ContextMenuSurface from "./ContextMenuSurface.vue";
import DialogHost from "./DialogHost.vue";
import { openDialog, closeDialog } from "@/composables/useDialog";

afterEach(() => {
  document.body.innerHTML = "";
});

it("moves menu focus, skips disabled items, closes with Escape and removes its global handler", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const menu = mount(ContextMenuSurface, {
    props: { open: false, anchorX: 100, anchorY: 100 },
    slots: {
      default:
        '<button id="first">First</button><button disabled>Disabled</button><button id="last">Last</button>',
    },
    attachTo: document.body,
  });
  await menu.setProps({ open: true });
  await nextTick();
  expect(document.activeElement?.id).toBe("first");
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  expect(document.activeElement?.id).toBe("last");
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(menu.emitted("close")).toHaveLength(1);
  await menu.setProps({ open: false });
  expect(document.activeElement).toBe(opener);
  await menu.setProps({ open: true });
  menu.unmount();
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it("focuses nested dialogs, traps Tab, restores the parent input and settles promises on unmount", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const host = mount(DialogHost, { attachTo: document.body });
  const Parent = defineComponent({
    template:
      '<div role="dialog"><input id="parent-input" autofocus /><button id="parent-last">OK</button></div>',
  });
  const Child = defineComponent({
    template:
      '<div role="dialog"><input id="child-input" /><button id="child-last">OK</button></div>',
  });
  const outer = openDialog(Parent);
  await nextTick();
  await nextTick();
  expect(document.activeElement?.id).toBe("parent-input");
  const inner = openDialog(Child);
  await nextTick();
  await nextTick();
  expect(document.activeElement?.id).toBe("child-input");
  document.getElementById("child-last")!.focus();
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
  );
  expect(document.activeElement?.id).toBe("child-input");
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  expect(await inner).toBeNull();
  await nextTick();
  await nextTick();
  expect(document.activeElement?.id).toBe("parent-input");
  host.unmount();
  expect(await outer).toBeNull();
});

it("does not dismiss the parent twice when a child handles Escape itself", async () => {
  const host = mount(DialogHost, { attachTo: document.body });
  const Parent = defineComponent({ template: '<div role="dialog"><input id="parent" /></div>' });
  const Child = defineComponent({
    setup: () => ({ cancel: () => closeDialog(false) }),
    template: '<div role="dialog" @keydown.esc="cancel"><input id="child" /></div>',
  });
  const outer = openDialog(Parent);
  await nextTick();
  const inner = openDialog(Child);
  await nextTick();
  await nextTick();
  document
    .getElementById("child")!
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  expect(await inner).toBe(false);
  await nextTick();
  await nextTick();
  expect(document.activeElement?.id).toBe("parent");
  host.unmount();
  expect(await outer).toBeNull();
});
