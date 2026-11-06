import { ref } from "vue";

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  persistent?: boolean;
};

const toasts = ref<ToastItem[]>([]);

export function useToasts() {
  return toasts;
}

export function toast(input: Omit<ToastItem, "id">) {
  const item: ToastItem = { id: crypto.randomUUID(), ...input };
  toasts.value = [...toasts.value, item];
  if (!item.persistent) {
    window.setTimeout(() => dismissToast(item.id), 2000);
  }
  return item.id;
}

export function dismissToast(id: string) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
