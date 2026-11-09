import { computed, shallowRef, type Component } from "vue";

type DialogState = {
  id: number;
  component: Component;
  props: Record<string, unknown>;
  resolve: (value: unknown) => void;
};

const stack = shallowRef<DialogState[]>([]);
const current = computed(() => stack.value.at(-1) ?? null);
let nextId = 0;

export function useDialogStack() {
  return stack;
}

export function useDialogState() {
  return current;
}

export function openDialog<T = unknown>(
  component: Component,
  props: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve) => {
    stack.value = [
      ...stack.value,
      {
        id: ++nextId,
        component,
        props,
        resolve: (v) => resolve(v as T),
      },
    ];
  });
}

export function closeDialog(result?: unknown, id = current.value?.id) {
  const cur = stack.value.find((dialog) => dialog.id === id);
  stack.value = stack.value.filter((dialog) => dialog.id !== id);
  cur?.resolve(result);
}

export const dialogService = {
  open: openDialog,
  close: closeDialog,
};
