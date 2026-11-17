import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import MoveToChangelistDialog from "./MoveToChangelistDialog.vue";

const mocks = vi.hoisted(() => ({
  changes: {} as any,
  close: vi.fn(),
  dialog: { id: "dlg-1" },
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/composables/useDialog", () => ({
  useDialogState: () => ({ value: mocks.dialog }),
  closeDialog: mocks.close,
}));
vi.mock("@/composables/useRepositoryAction", () => ({
  useRepositoryAction: () => () => ({
    current: () => true,
    path: "repo",
    repoId: "repo",
  }),
}));

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.changes = reactive({
    changed: [
      { path: "a.txt", origPath: null, indexStatus: ".", worktreeStatus: "M", kind: "modified" },
      { path: "b.txt", origPath: null, indexStatus: ".", worktreeStatus: "M", kind: "modified" },
    ],
    changelists: {
      lists: [
        { id: "default", name: "Changes", comment: "", active: true },
        { id: "cl-123", name: "123", comment: "", active: false },
      ],
      assignments: [],
    },
  });
});

it("preselects the Changes selection and can move to an existing list", async () => {
  const wrapper = mount(MoveToChangelistDialog, {
    props: { initialPaths: ["a.txt"], sourceListId: "default" },
    attachTo: document.body,
  });
  await flushPromises();
  const checks = wrapper.findAll('input[type="checkbox"]');
  expect(checks.some((box) => (box.element as HTMLInputElement).checked)).toBe(true);
  await wrapper.get("select").setValue("cl-123");
  await wrapper.get('button[type="submit"]').trigger("click");
  expect(mocks.close).toHaveBeenCalledWith(
    {
      paths: ["a.txt"],
      newName: null,
      targetListId: "cl-123",
    },
    "dlg-1",
  );
});

it("supports creating a new changelist name as the move target", async () => {
  const wrapper = mount(MoveToChangelistDialog, {
    props: { initialPaths: ["b.txt"] },
    attachTo: document.body,
  });
  await flushPromises();
  const radios = wrapper.findAll('input[type="radio"]');
  await radios[1]!.setValue("new");
  await wrapper.get('input[placeholder="changelist.namePlaceholder"]').setValue("feature");
  await wrapper.get('button[type="submit"]').trigger("click");
  expect(mocks.close).toHaveBeenCalledWith(
    {
      paths: ["b.txt"],
      newName: "feature",
      targetListId: null,
    },
    "dlg-1",
  );
});
