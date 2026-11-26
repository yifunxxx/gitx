import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import JobsPopup from "./JobsPopup.vue";
import { useJobsStore } from "@/stores/jobsStore";

const mocks = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ jobList: vi.fn().mockResolvedValue([]), jobCancel: mocks.cancel }),
}));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

enableAutoUnmount(afterEach);
let pinia: ReturnType<typeof createPinia>;
const releases: Array<() => void> = [];
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
});
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await flushPromises();
  disposePinia(pinia);
  document.body.innerHTML = "";
});
function key(value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  document.activeElement!.dispatchEvent(event);
  return event;
}
async function fixture(cancellable = false) {
  const jobs = useJobsStore();
  for (let index = 0; index < (cancellable ? 3 : 40); index++) {
    jobs.started({
      id: String(index),
      title: "Fetching",
      message: `repo-${index}`,
      cancellable,
      percent: 45,
    });
  }
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  jobs.openPopup();
  mount(JobsPopup, { attachTo: document.body });
  await flushPromises();
  const panel = document.querySelector<HTMLElement>(".context-menu-panel")!;
  return {
    jobs,
    opener,
    panel,
    buttons: Array.from(panel.querySelectorAll<HTMLButtonElement>("button")),
  };
}

it("focuses the task content and preserves native scrolling keys for a readonly queue", async () => {
  const { panel, jobs, opener } = await fixture();
  expect(panel.getAttribute("role")).toBe("dialog");
  expect(document.activeElement).toBe(panel);
  for (const value of ["End", "Home", "ArrowDown", "ArrowUp", "PageDown", "PageUp"]) {
    expect(key(value).defaultPrevented).toBe(false);
  }
  key("Escape");
  await flushPromises();
  expect(jobs.popupOpen).toBe(false);
  expect(document.activeElement).toBe(opener);
});

it("associates each cancel button and progress bar with its task and repository", async () => {
  const { panel, buttons } = await fixture(true);
  const progress = panel.querySelectorAll('[role="progressbar"]');
  for (let index = 0; index < 3; index++) {
    expect(buttons[index]!.getAttribute("aria-label")).toContain(`repo-${index}`);
    expect(buttons[index]!.getAttribute("aria-label")).toContain("Fetching");
    expect(progress[index]!.getAttribute("aria-label")).toContain(`repo-${index}`);
  }
});

it("cycles Tab through content and enabled buttons without dismissing the queue", async () => {
  const { panel, buttons, jobs } = await fixture(true);
  buttons[1]!.disabled = true;
  key("Tab");
  expect(document.activeElement).toBe(buttons[0]);
  key("Tab");
  expect(document.activeElement).toBe(buttons[2]);
  key("Tab");
  expect(document.activeElement).toBe(panel);
  key("Tab", { shiftKey: true });
  expect(document.activeElement).toBe(buttons[2]);
  expect(jobs.popupOpen).toBe(true);
});

it("keeps cancel focus in the panel while pending and after its row disappears", async () => {
  let resolve!: (accepted: boolean) => void;
  mocks.cancel.mockReturnValue(
    new Promise<boolean>((done) => {
      resolve = done;
    }),
  );
  releases.push(() => resolve(false));
  const { panel, buttons, jobs, opener } = await fixture(true);
  buttons[1]!.focus();
  buttons[1]!.click();
  await flushPromises();
  expect(buttons[1]!.disabled).toBe(true);
  expect(document.activeElement).toBe(panel);
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("1");
  jobs.finished("1");
  resolve(true);
  await flushPromises();
  expect(document.activeElement).toBe(panel);
  key("Escape");
  await flushPromises();
  expect(document.activeElement).toBe(opener);
});

it("does not steal focus on pointer movement or activate a cancel from held Enter", async () => {
  const { panel, buttons } = await fixture(true);
  buttons[0]!.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
  );
  expect(document.activeElement).toBe(panel);
  buttons[0]!.focus();
  expect(key("Enter", { repeat: true }).defaultPrevented).toBe(true);
  expect(mocks.cancel).not.toHaveBeenCalled();
});

it("ignores composing, held and modified dismissal and isolates background shortcuts", async () => {
  const { jobs } = await fixture();
  const globalKey = vi.fn();
  window.addEventListener("keydown", globalKey);
  try {
    for (const options of [
      { isComposing: true },
      { repeat: true },
      { keyCode: 229 },
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      key("Escape", options);
      expect(jobs.popupOpen).toBe(true);
    }
    key("Delete");
    expect(globalKey).not.toHaveBeenCalled();
    key("Escape");
    expect(jobs.popupOpen).toBe(false);
  } finally {
    window.removeEventListener("keydown", globalKey);
  }
});
