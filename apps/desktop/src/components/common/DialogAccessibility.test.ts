import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import DialogHost from "./DialogHost.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import PromptDialog from "./PromptDialog.vue";
import { openDialog } from "@/composables/useDialog";

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

let host: ReturnType<typeof mount>;
beforeEach(() => {
  host = mount(DialogHost, { attachTo: document.body });
});
afterEach(() => {
  host.unmount();
  document.body.innerHTML = "";
});

async function rendered() {
  await nextTick();
  await nextTick();
}

function referencedText(element: Element, attribute: string) {
  const ids = element.getAttribute(attribute)?.split(/\s+/) ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent).join(" ");
}

it("names confirmations and lets the keyboard focus the complete scrollable message", async () => {
  const message = Array.from({ length: 1000 }, (_, index) => `src/file-${index}.txt`).join("\n");
  const result = openDialog(ConfirmDialog, {
    title: "Review selected files",
    message,
    destructive: true,
  });
  await rendered();
  const dialog = host.get('[role="dialog"]');
  expect(referencedText(dialog.element, "aria-labelledby")).toBe("Review selected files");
  const details = dialog.get("p");
  expect(details.text()).toBe(message);
  expect(details.attributes("tabindex")).toBe("0");
  expect(referencedText(details.element, "aria-labelledby")).toBe("Review selected files");
  // Opening a destructive confirmation still starts on Cancel, not its action.
  const buttons = dialog.findAll("button");
  expect(document.activeElement).toBe(buttons[0]!.element);
  (buttons.at(-1)!.element as HTMLButtonElement).focus();
  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
  );
  expect(document.activeElement).toBe(details.element);
  // Scrolling keys must keep their browser default rather than confirm/cancel.
  const end = new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
  details.element.dispatchEvent(end);
  expect(end.defaultPrevented).toBe(false);
  details.element.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  expect(await result).toBe(false);
});

it.each([undefined, "Folder relative to the workspace"])(
  "names the prompt and input with optional help: %s",
  async (message) => {
    const result = openDialog(PromptDialog, {
      title: "Choose destination",
      message,
      defaultValue: "src/new",
    });
    await rendered();
    const dialog = host.get('[role="dialog"]');
    const input = dialog.get<HTMLInputElement>("input");
    expect(referencedText(dialog.element, "aria-labelledby")).toBe("Choose destination");
    expect(referencedText(input.element, "aria-labelledby")).toBe("Choose destination");
    if (message) expect(referencedText(input.element, "aria-describedby")).toBe(message);
    else expect(input.attributes("aria-describedby")).toBeUndefined();
    expect(document.activeElement).toBe(input.element);
    expect(input.element.selectionStart).toBe(0);
    expect(input.element.selectionEnd).toBe("src/new".length);
    await input.setValue("destination");
    await input.trigger("keydown", { key: "Enter" });
    expect(await result).toBe("destination");
  },
);

it("keeps nested dialog names distinct and returns focus to the parent input", async () => {
  const parent = openDialog(PromptDialog, { title: "Parent destination", defaultValue: "draft" });
  await rendered();
  const parentPanel = host.get('[role="dialog"]');
  const parentInput = parentPanel.get<HTMLInputElement>("input");
  const child = openDialog(ConfirmDialog, {
    title: "Child confirmation",
    message: "Keep the draft?",
  });
  await rendered();
  const dialogs = host.findAll('[role="dialog"]');
  expect(dialogs).toHaveLength(2);
  expect(dialogs[0]!.attributes("aria-labelledby")).not.toBe(
    dialogs[1]!.attributes("aria-labelledby"),
  );
  expect(referencedText(dialogs[0]!.element, "aria-labelledby")).toBe("Parent destination");
  expect(referencedText(dialogs[1]!.element, "aria-labelledby")).toBe("Child confirmation");
  await dialogs[1]!.get("button").trigger("click");
  expect(await child).toBe(false);
  await rendered();
  expect(document.activeElement).toBe(parentInput.element);
  expect(parentInput.element.value).toBe("draft");
  await parentInput.trigger("keydown", { key: "Escape" });
  expect(await parent).toBeNull();
});
