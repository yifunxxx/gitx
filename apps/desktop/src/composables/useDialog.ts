import { shallowRef, type Component } from "vue";

type DialogState = {
  component: Component;
  props: Record<string, unknown>;
  resolve: (value: unknown) => void;
} | null;

const current = shallowRef<DialogState>(null);

export function useDialogState() {
  return current;
}

export function openDialog<T = unknown>(
  component: Component,
  props: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve) => {
    current.value = {
      component,
      props,
      resolve: (v) => resolve(v as T),
    };
  });
}

export function closeDialog(result?: unknown) {
  const cur = current.value;
  current.value = null;
  cur?.resolve(result);
}

export const dialogService = {
  open: openDialog,
  close: closeDialog,
};
