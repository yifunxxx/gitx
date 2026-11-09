import { ref } from "vue";

export type ToastAction = {
  label: string;
  disabled?: () => boolean;
  onClick: () => void | false;
};

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  persistent?: boolean;
  action?: ToastAction;
};

const toasts = ref<ToastItem[]>([]);
const timers = new Map<string, number>();

export function useToasts() {
  return toasts;
}

export function toast(input: Omit<ToastItem, "id">) {
  // Dedupe rapid identical non-action toasts (overlapping jobs / double refresh).
  if (!input.action && !input.persistent) {
    const dup = toasts.value.find(
      (t) =>
        !t.action &&
        !t.persistent &&
        t.title === input.title &&
        t.description === input.description,
    );
    if (dup) {
      const prev = timers.get(dup.id);
      if (prev) window.clearTimeout(prev);
      const ttl = 2000;
      timers.set(
        dup.id,
        window.setTimeout(() => dismissToast(dup.id), ttl),
      );
      return dup.id;
    }
  }

  const item: ToastItem = { id: crypto.randomUUID(), ...input };
  toasts.value = [...toasts.value, item];
  // Leave time to read the result and reach the action with keyboard navigation.
  const ttl = item.persistent ? null : item.action ? 30000 : 2000;
  if (ttl != null) {
    timers.set(
      item.id,
      window.setTimeout(() => dismissToast(item.id), ttl),
    );
  }
  // Cap stack to avoid Busy/toast storms under concurrency stress.
  if (toasts.value.length > 5) {
    const drop = toasts.value.slice(0, toasts.value.length - 5);
    for (const d of drop) dismissToast(d.id);
  }
  return item.id;
}

export function dismissToast(id: string) {
  const timer = timers.get(id);
  if (timer) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
