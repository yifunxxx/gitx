import { afterEach, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, onUnmounted, ref } from "vue";
import DialogHost from "./DialogHost.vue";
import { openDialog, closeDialog } from "@/composables/useDialog";

afterEach(() => {
  document.body.innerHTML = "";
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

it("preserves the parent form and restores the opener after the last dialog closes", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const host = mount(DialogHost, { attachTo: document.body });
  let unmounts = 0;
  const Parent = defineComponent({
    setup() {
      onUnmounted(() => ++unmounts);
      return { value: ref("") };
    },
    template: '<div><input id="preserved" v-model="value" /></div>',
  });
  const outer = openDialog(Parent);
  await nextTick();
  await nextTick();
  const input = document.getElementById("preserved") as HTMLInputElement;
  input.value = "unfinished clone URL";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const inner = openDialog(defineComponent({ template: '<button id="nested">Authorize</button>' }));
  await nextTick();
  await nextTick();
  expect(unmounts).toBe(0);
  expect(input.closest("[inert]")).not.toBeNull();
  closeDialog("authorized");
  expect(await inner).toBe("authorized");
  await nextTick();
  await nextTick();
  expect(document.getElementById("preserved")).toBe(input);
  expect(input.value).toBe("unfinished clone URL");
  expect(document.activeElement).toBe(input);
  closeDialog("done");
  expect(await outer).toBe("done");
  await nextTick();
  await nextTick();
  expect(document.activeElement).toBe(opener);
  expect(unmounts).toBe(1);
  host.unmount();
});

it("wraps Shift+Tab in the active dialog and ignores composing Escape", async () => {
  const host = mount(DialogHost, { attachTo: document.body });
  const result = openDialog(defineComponent({
    template: '<div><input id="first-field" /><button disabled>Disabled</button><button id="last-button">OK</button></div>',
  }));
  await nextTick();
  await nextTick();
  document.getElementById("first-field")!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
  );
  expect(document.activeElement?.id).toBe("last-button");
  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }),
  );
  await nextTick();
  expect(document.getElementById("first-field")).not.toBeNull();
  host.unmount();
  expect(await result).toBeNull();
});
