import { ref } from "vue";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  persistent?: boolean;
  action?: ToastAction;
};

const toasts = ref<ToastItem[]>([]);

export function useToasts() {
  return toasts;
}

export function toast(input: Omit<ToastItem, "id">) {
  const item: ToastItem = { id: crypto.randomUUID(), ...input };
  toasts.value = [...toasts.value, item];
  // Keep actionable toasts visible longer so Undo remains reachable.
  const ttl = item.persistent ? null : item.action ? 8000 : 2000;
  if (ttl != null) {
    window.setTimeout(() => dismissToast(item.id), ttl);
  }
  return item.id;
}

export function dismissToast(id: string) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
