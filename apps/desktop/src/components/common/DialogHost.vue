<script setup lang="ts">
import { nextTick, onUnmounted, watch } from "vue";
import { closeDialog, useDialogStack } from "@/composables/useDialog";

const stack = useDialogStack();
const previousFocus = new Map<number, HTMLElement | null>();
let disposed = false;

function topPanel() {
  const id = stack.value.at(-1)?.id;
  return id == null ? null : document.querySelector<HTMLElement>(`[data-dialog-host="${id}"]`);
}

function focusable(panel: HTMLElement) {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.closest("[hidden], [inert]") && getComputedStyle(el).display !== "none");
}

watch(
  stack,
  async (dialogs, old) => {
    const top = dialogs.at(-1);
    const oldTop = old.at(-1);
    if (top && !previousFocus.has(top.id))
      previousFocus.set(top.id, document.activeElement as HTMLElement | null);
    const restore = oldTop && !dialogs.includes(oldTop) ? previousFocus.get(oldTop.id) : null;
    for (const id of previousFocus.keys())
      if (!dialogs.some((dialog) => dialog.id === id)) previousFocus.delete(id);
    await nextTick();
    if (disposed) return;
    if (restore?.isConnected) restore.focus({ preventScroll: true });
    const panel = topPanel();
    if (panel && !panel.contains(document.activeElement)) {
      (panel.querySelector<HTMLElement>("[autofocus]") ?? focusable(panel)[0])?.focus();
    }
  },
  { flush: "pre" },
);

function onTab(event: KeyboardEvent) {
  const panel = topPanel();
  if (!panel) return;
  const items = focusable(panel);
  if (!items.length) {
    event.preventDefault();
    return;
  }
  const first = items[0]!;
  const last = items.at(-1)!;
  if (
    !panel.contains(document.activeElement) ||
    (event.shiftKey ? document.activeElement === first : document.activeElement === last)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

function onEscape(event: KeyboardEvent, id: number) {
  if (event.defaultPrevented || event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  // A child may already have handled Escape and closed itself. Never let that
  // same event dismiss the parent that has just become the top dialog.
  if (stack.value.at(-1)?.id === id) closeDialog(null, id);
}

onUnmounted(() => {
  disposed = true;
  previousFocus.clear();
  while (stack.value.length) closeDialog(null);
});
</script>

<template>
  <div
    v-for="(dialog, index) in stack"
    :key="dialog.id"
    class="pointer-events-none fixed inset-0 z-[80] [&>*]:pointer-events-auto"
    v-show="index === stack.length - 1"
    :data-dialog-host="dialog.id"
    :inert="index !== stack.length - 1"
    @keydown.tab="onTab"
    @keydown.esc="onEscape($event, dialog.id)"
  >
    <component :is="dialog.component" v-bind="dialog.props" />
  </div>
</template>
