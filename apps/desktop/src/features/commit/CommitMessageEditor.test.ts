import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import CommitMessageEditor from "./CommitMessageEditor.vue";

const m = vi.hoisted(() => ({
  commit: {} as any,
  workspace: {} as any,
  rewrite: {} as any,
  toast: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/stores/commitStore", () => ({ useCommitStore: () => m.commit }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => m.workspace }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => m.rewrite }));
vi.mock("@/stores/logStore", () => ({
  useLogStore: () => ({ commits: [{ sha: "older", subject: "old subject" }] }),
}));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  vi.resetAllMocks();
  m.workspace = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    navigation: 1,
    navigationToken() {
      return this.navigation;
    },
  });
  m.commit = reactive({
    message: "draft",
    amend: true,
    amendLoading: false,
    amendError: "",
    committing: false,
    runHooks: true,
    commit: vi.fn(),
    setAmend: vi.fn(),
  });
  m.rewrite = reactive({ busy: false, fixupInto: vi.fn() });
  wrapper = mount(CommitMessageEditor, {
    global: {
      stubs: {
        Tip: { template: "<div><slot /></div>" },
        Button: { template: "<button><slot /></button>" },
        Select: {
          name: "Select",
          props: ["modelValue", "disabled"],
          emits: ["update:modelValue"],
          template:
            '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
        },
        SelectItem: { props: ["value"], template: '<option :value="value"><slot /></option>' },
        SelectContent: { template: "<slot />" },
        SelectTrigger: { template: "<span />" },
      },
    },
  });
});
afterEach(() => wrapper.unmount());
const submit = () =>
  wrapper.findAll("button").find((button) => button.text() === "commit.amendCommitAction")!;

it("shows loading, blocks submission and target selection, but allows cancel and typing", async () => {
  m.commit.amendLoading = true;
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toBe("commit.amendLoading");
  expect(submit().attributes("disabled")).toBeDefined();
  expect(wrapper.get("select").attributes("disabled")).toBeDefined();
  expect(wrapper.get('input[type="checkbox"]').attributes("disabled")).toBeUndefined();
  await wrapper.get("textarea").setValue("manual input");
  expect(m.commit.message).toBe("manual input");
  await wrapper.get('input[type="checkbox"]').setValue(false);
  expect(m.commit.setAmend).toHaveBeenCalledWith(false);
});

it("shows the loading error with a retry button and blocks submission", async () => {
  m.commit.amendError = "HEAD unavailable";
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("HEAD unavailable");
  expect(submit().attributes("disabled")).toBeDefined();
  await wrapper.get('[role="alert"] button').trigger("click");
  expect(m.commit.setAmend).toHaveBeenCalledWith(true);
});

it.each(["committing", "rewrite"])(
  "locks mode controls during %s but keeps the draft editable",
  async (kind) => {
    if (kind === "committing") m.commit.committing = true;
    else m.rewrite.busy = true;
    await flushPromises();
    for (const control of wrapper.findAll("input, select, button"))
      expect(control.attributes("disabled")).toBeDefined();
    await wrapper.get("textarea").setValue("next draft");
    expect(m.commit.message).toBe("next draft");
  },
);

it("consumes a commit rejection already reported by the store", async () => {
  m.commit.commit.mockRejectedValue(new Error("hook failed"));
  await submit().trigger("click");
  await flushPromises();
  expect(m.commit.commit).toHaveBeenCalledOnce();
  expect(m.commit.message).toBe("draft");
  expect(m.toast).not.toHaveBeenCalled();
});

it("does not start fixup after navigation during the Amend transition", async () => {
  const pending = deferred<void>();
  m.commit.setAmend.mockReturnValue(pending.promise);
  await wrapper.get("select").setValue("older");
  ++m.workspace.navigation;
  pending.resolve();
  await flushPromises();
  expect(m.rewrite.fixupInto).not.toHaveBeenCalled();
  expect((wrapper.get("select").element as HTMLSelectElement).value).toBe("HEAD");
});

it("prevents duplicate fixup while its transition is pending", async () => {
  const pending = deferred<void>();
  m.commit.setAmend.mockReturnValue(pending.promise);
  await wrapper.get("select").setValue("older");
  wrapper.findComponent({ name: "Select" }).vm.$emit("update:modelValue", "older");
  pending.resolve();
  await flushPromises();
  expect(m.commit.setAmend).toHaveBeenCalledOnce();
  expect(m.rewrite.fixupInto).toHaveBeenCalledExactlyOnceWith("older", false);
});

it.each(["navigate-success", "navigate-failure", "unmount"])(
  "ignores a late fixup result after %s",
  async (kind) => {
    const pending = deferred<any>();
    m.rewrite.fixupInto.mockReturnValue(pending.promise);
    await wrapper.get("select").setValue("older");
    await flushPromises();
    expect(m.rewrite.fixupInto).toHaveBeenCalledOnce();
    if (kind === "unmount") wrapper.unmount();
    else ++m.workspace.navigation;
    if (kind === "navigate-failure") pending.reject(new Error("old failure"));
    else pending.resolve({ outcome: "ok" });
    await flushPromises();
    expect(m.toast).not.toHaveBeenCalled();
  },
);

it.each([null, { outcome: "conflicts" }])(
  "does not announce fixup success for a cancelled or conflicted result",
  async (result) => {
    m.rewrite.fixupInto.mockResolvedValue(result);
    await wrapper.get("select").setValue("older");
    await flushPromises();
    expect(m.toast).not.toHaveBeenCalled();
  },
);
