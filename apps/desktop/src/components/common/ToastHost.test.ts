import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import ToastHost from "./ToastHost.vue";
import { dismissToast, toast, useToasts } from "@/composables/useToast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const item of useToasts().value) dismissToast(item.id);
  vi.useRealTimers();
});

it("keeps a busy action visible and enables it when refresh finishes", async () => {
  const busy = ref(true);
  const run = vi.fn();
  const id = toast({
    title: "Saved",
    action: { label: "Undo", disabled: () => busy.value, onClick: run },
  });
  const host = mount(ToastHost, { global: { mocks: { $t: (key: string) => key } } });
  const action = host.findAll("button")[0]!;
  expect(action.attributes("disabled")).toBeDefined();
  await action.trigger("click");
  expect(run).not.toHaveBeenCalled();
  expect(useToasts().value.some((item) => item.id === id)).toBe(true);
  busy.value = false;
  await nextTick();
  expect(action.attributes("disabled")).toBeUndefined();
  await action.trigger("click");
  expect(run).toHaveBeenCalledOnce();
  expect(useToasts().value).toEqual([]);
  host.unmount();
});

it("retains an action when its handler declines execution", async () => {
  toast({ title: "Saved", action: { label: "Undo", onClick: () => false } });
  const host = mount(ToastHost, { global: { mocks: { $t: (key: string) => key } } });
  await host.findAll("button")[0]!.trigger("click");
  expect(useToasts().value).toHaveLength(1);
  host.unmount();
});

it("leaves actions reachable for thirty seconds and clears dismissed timers", () => {
  const id = toast({ title: "Saved", action: { label: "Undo", onClick: vi.fn() } });
  vi.advanceTimersByTime(8000);
  expect(useToasts().value.some((item) => item.id === id)).toBe(true);
  vi.advanceTimersByTime(21999);
  expect(useToasts().value).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(useToasts().value).toEqual([]);
  const second = toast({ title: "Another", action: { label: "Undo", onClick: vi.fn() } });
  dismissToast(second);
  expect(vi.getTimerCount()).toBe(0);
});
