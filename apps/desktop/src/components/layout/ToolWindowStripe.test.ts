import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import ToolWindowStripe from "./ToolWindowStripe.vue";
import { useLayoutStore } from "@/stores/layoutStore";
import { i18n } from "@/i18n";
import { activeFileDrag, endFileDrag } from "@/features/file-tree/fileDrag";

enableAutoUnmount(afterEach);
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  i18n.global.locale.value = "en";
});
afterEach(() => {
  endFileDrag();
  vi.useRealTimers();
  disposePinia(pinia);
  localStorage.clear();
  i18n.global.locale.value = "en";
});
it("reveals Commit after hovering with a File drag and cancels early exits", async () => {
  vi.useFakeTimers();
  const wrapper = mount(ToolWindowStripe, { global: { plugins: [i18n] } });
  const layout = useLayoutStore();
  layout.showLeftTab("file");
  activeFileDrag.value = { folder: "C:/p", paths: ["a"], navigation: 1, applied: 1 };
  const commit = wrapper.findAll("button")[0]!;
  await commit.trigger("dragover");
  await commit.trigger("dragleave");
  await vi.advanceTimersByTimeAsync(500);
  expect(layout.activeLeftTab).toBe("file");
  await commit.trigger("dragover");
  await vi.advanceTimersByTimeAsync(450);
  expect(layout.activeLeftTab).toBe("commit");
});

it("places File below Commit, switches tabs, and closes/reopens the selected File dock", async () => {
  const wrapper = mount(ToolWindowStripe, { global: { plugins: [i18n] } });
  const layout = useLayoutStore();
  const [commit, file] = wrapper.findAll("button");
  expect(commit!.text()).toBe("Commit");
  expect(file!.text()).toBe("File");
  layout.leftSize = 37;
  await file!.trigger("click");
  expect(layout.activeLeftTab).toBe("file");
  expect(layout.leftOpen).toBe(true);
  expect(file!.attributes("aria-pressed")).toBe("true");
  expect(commit!.attributes("aria-pressed")).toBe("false");
  await file!.trigger("click");
  expect(layout.leftOpen).toBe(false);
  await file!.trigger("click");
  expect(layout.leftOpen).toBe(true);
  await commit!.trigger("click");
  expect(layout.activeLeftTab).toBe("commit");
  expect(layout.leftOpen).toBe(true);
  expect(layout.leftSize).toBe(37);
});

it("replaces floating Commit with File without overwriting the Commit mode preference", async () => {
  const wrapper = mount(ToolWindowStripe, { global: { plugins: [i18n] } });
  const layout = useLayoutStore();
  layout.commitTwMode = "float";
  layout.leftOpen = false;
  const [commit, file] = wrapper.findAll("button");
  await file!.trigger("click");
  expect(layout.activeLeftTab).toBe("file");
  expect(layout.leftOpen).toBe(true);
  expect(layout.commitTwMode).toBe("float");
  expect(commit!.attributes("aria-pressed")).toBe("false");
  await commit!.trigger("click");
  expect(layout.activeLeftTab).toBe("commit");
  expect(layout.leftOpen).toBe(false);
  expect(commit!.attributes("aria-pressed")).toBe("true");
});

it("restores the selected File tab and its closed state, including a saved float preference", async () => {
  const layout = useLayoutStore();
  layout.commitTwMode = "float";
  layout.showLeftTab("file");
  layout.toggleLeftTab("file");
  await nextTick();
  disposePinia(pinia);
  pinia = createPinia();
  setActivePinia(pinia);
  const restored = useLayoutStore();
  expect(restored.activeLeftTab).toBe("file");
  expect(restored.leftOpen).toBe(false);
  expect(restored.commitTwMode).toBe("float");
});

it("localizes the File stripe in Chinese", async () => {
  i18n.global.locale.value = "zh-CN";
  const wrapper = mount(ToolWindowStripe, { global: { plugins: [i18n] } });
  expect(wrapper.findAll("button")[1]!.text()).toBe("文件");
});
