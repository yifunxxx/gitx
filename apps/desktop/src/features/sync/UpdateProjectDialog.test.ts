import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive, shallowRef } from "vue";
import UpdateProjectDialog from "./UpdateProjectDialog.vue";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  dialog: {} as any,
  settings: { settings: { git: { updateMethod: "merge" } }, save: vi.fn() },
  sync: { updating: false, updateProject: vi.fn() },
  close: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => mocks.sync }));
vi.mock("@/composables/useDialog", () => ({
  useDialogState: () => mocks.dialog,
  closeDialog: mocks.close,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
let wrapper: ReturnType<typeof mount>;
const submit = () => wrapper.findAll("button").at(-1)!;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace = reactive({
    repoPath: "A",
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  });
  mocks.dialog = shallowRef({ id: 42 });
  wrapper = mount(UpdateProjectDialog);
});
afterEach(() => wrapper.unmount());

it("blocks submission after workspace navigation away and back", async () => {
  mocks.workspace.repoPath = "B";
  mocks.workspace.generation++;
  mocks.workspace.repoPath = "A";
  mocks.workspace.generation++;
  await flushPromises();
  expect(submit().attributes("disabled")).toBeDefined();
  await submit().trigger("click");
  expect(mocks.sync.updateProject).not.toHaveBeenCalled();
  expect(wrapper.get('[role="alert"]').text()).toBe("syncUi.repositoryChanged");
});

it("prevents duplicate settings saves and does not update another repository after saving", async () => {
  let finish!: () => void;
  mocks.settings.save.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  await wrapper.get('input[type="checkbox"]').setValue(true);
  await submit().trigger("click");
  await submit().trigger("click");
  expect(mocks.settings.save).toHaveBeenCalledOnce();
  mocks.workspace.generation++;
  finish();
  await flushPromises();
  expect(mocks.sync.updateProject).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
});

it("keeps settings errors visible and permits an explicit retry", async () => {
  mocks.settings.save.mockRejectedValueOnce(new Error("settings read-only"));
  await wrapper.get('input[type="checkbox"]').setValue(true);
  await submit().trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("settings read-only");
  expect(mocks.sync.updateProject).not.toHaveBeenCalled();
  await submit().trigger("click");
  await flushPromises();
  expect(mocks.sync.updateProject).toHaveBeenCalledOnce();
  expect(mocks.close).toHaveBeenCalledWith(true, 42);
});

it("does not close a replacement dialog when a pending update completes", async () => {
  let finish!: () => void;
  mocks.sync.updateProject.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  await submit().trigger("click");
  mocks.dialog.value = { id: 43 };
  finish();
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
});
