import { beforeEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import type { UpdateInfo } from "@/lib/backend";
import UpdateInfoView from "./UpdateInfoView.vue";

const mocks = vi.hoisted(() => ({ sync: { lastUpdate: null as UpdateInfo | null } }));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => mocks.sync }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  mocks.sync.lastUpdate = {
    oldHead: "parent-before",
    newHead: "parent-after",
    strategy: "merge",
    message: "parent updated",
    commits: ["parent-after new pointer"],
    updatedFiles: [],
    submoduleError: null,
    submodules: null,
  };
});

it("displays successful, skipped and failed module paths, actual SHAs and reasons", () => {
  mocks.sync.lastUpdate!.submodules = {
    message: "summary",
    items: [
      {
        path: "module 中文",
        oldSha: "1111111old",
        newSha: "2222222new",
        onBranch: null,
        updated: true,
        skipped: false,
        message: "updated",
      },
      {
        path: "nested/branch",
        oldSha: "3333333old",
        newSha: "3333333old",
        onBranch: "keep",
        updated: false,
        skipped: true,
        message: "branch keep preserved",
      },
      {
        path: "dirty module",
        oldSha: "4444444old",
        newSha: "4444444old",
        onBranch: null,
        updated: false,
        skipped: false,
        message: "local changes would be overwritten",
      },
    ],
  };
  const wrapper = mount(UpdateInfoView, { global: { stubs: { PathTreeList: true } } });
  for (const text of [
    "module 中文",
    "1111111 → 2222222",
    "syncUi.submoduleUpdated",
    "nested/branch",
    "syncUi.submoduleSkipped",
    "branch keep preserved",
    "dirty module",
    "syncUi.submoduleFailed",
    "local changes would be overwritten",
    "parent updated",
    "parent-after new pointer",
  ]) {
    expect(wrapper.text()).toContain(text);
  }
  wrapper.unmount();
});

it("keeps the parent result visible alongside a top-level submodule error", () => {
  mocks.sync.lastUpdate!.submoduleError = "invalid .gitmodules";
  const wrapper = mount(UpdateInfoView, { global: { stubs: { PathTreeList: true } } });
  expect(wrapper.get('[role="alert"]').text()).toBe("invalid .gitmodules");
  expect(wrapper.text()).toContain("parent-after new pointer");
  wrapper.unmount();
});
