import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import VirtualList from "@/components/common/VirtualList.vue";
import { buildLogTreeRows, logTreeRowKey, type LogTreeRow } from "./buildLogTreeRows";
import type { LogCommit } from "@/lib/backend";

const commit = (sha: string, parents: string[] = [], refs: string[] = []): LogCommit => ({
  sha,
  shortSha: sha,
  parents,
  refs,
  subject: sha,
  author: "QA",
  authorEmail: "qa@example.invalid",
  authorTime: 0,
  graph: { lane: 0, edges: [], color: 0 },
});
const history = (name: string) => [
  commit("merge", ["main-0", "side-0"], [`HEAD -> ${name}`]),
  ...Array.from({ length: 100 }, (_, index) =>
    commit(`main-${index}`, index === 99 ? [] : [`main-${index + 1}`]),
  ),
  ...Array.from({ length: 80 }, (_, index) =>
    commit(`side-${index}`, index === 79 ? ["main-99"] : [`side-${index + 1}`]),
  ),
];
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.unstubAllGlobals();
});

it.each(["main", "__other__"])(
  "keeps the Other heading at the same visible position after %s receives a new commit",
  async (name) => {
    const commits = history(name);
    const rows = buildLogTreeRows(commits);
    const anchor = rows.findIndex((row) => row.kind === "branch" && row.name === "Other");
    wrapper = mount(VirtualList, {
      props: {
        items: rows,
        itemHeight: 22,
        getKey: (item) => logTreeRowKey(item as LogTreeRow),
        preserveScrollAnchor: true,
        recycleKeys: true,
      },
      slots: {
        default: ({ item }) => {
          const row = item as LogTreeRow;
          return h("span", row.kind === "branch" ? row.name : row.commit.subject);
        },
      },
    });
    const port = wrapper.get(".overflow-auto").element;
    port.scrollTop = anchor * 22 + 5;
    const next = buildLogTreeRows([
      commit("new", ["merge"], [`HEAD -> ${name}`]),
      ...commits.map((row) => ({ ...row, refs: [] })),
    ]);
    await wrapper.setProps({ items: next });
    await flushPromises();
    const nextAnchor = next.findIndex((row) => row.kind === "branch" && row.name === "Other");
    expect(port.scrollTop).toBe(nextAnchor * 22 + 5);
    expect(wrapper.text()).toContain("side-0");
    expect(next[Math.floor(port.scrollTop / 22)]).toMatchObject({ kind: "branch", name: "Other" });
  },
);

it("keeps a real __other__ branch heading in place when another branch is added before it", async () => {
  const rows = buildLogTreeRows(history("__other__"));
  wrapper = mount(VirtualList, {
    props: {
      items: rows,
      itemHeight: 22,
      getKey: (item) => logTreeRowKey(item as LogTreeRow),
      preserveScrollAnchor: true,
      recycleKeys: true,
    },
  });
  const port = wrapper.get(".overflow-auto").element;
  port.scrollTop = 5;
  const next = buildLogTreeRows([commit("new-branch", [], ["topic"]), ...history("__other__")]);
  await wrapper.setProps({ items: next });
  await flushPromises();
  expect(port.scrollTop).toBe(2 * 22 + 5);
  expect(next[2]).toMatchObject({ kind: "branch", name: "__other__" });
});
