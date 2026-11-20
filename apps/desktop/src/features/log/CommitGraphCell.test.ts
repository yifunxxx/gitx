import { afterEach, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import CommitGraphCell from "./CommitGraphCell.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, args?: { parents?: string }) => `${key}:${args?.parents ?? ""}`,
    locale: ref("en"),
  }),
}));

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
const straight = (lane: number) => ({ fromLane: lane, toLane: lane });
const wideProps = () => ({
  graph: { lane: 0, color: 3, edges: Array.from({ length: 128 }, (_, lane) => straight(lane)) },
  edgeColors: Array.from({ length: 128 }, (_, lane) => lane % 12),
  maxLane: 127,
  laneWidth: 14,
});
function cell(props: Record<string, unknown> = {}) {
  const wrapper = mount(CommitGraphCell, { props: { ...wideProps(), ...props } });
  wrappers.push(wrapper);
  return wrapper;
}
const drawings = (wrapper: VueWrapper) =>
  wrapper.findAll("g > path").map((path) => ({
    d: path.attributes("d"),
    stroke: path.attributes("stroke"),
  }));

it("keeps the full graph for callers without a viewport", () => {
  const wrapper = cell();
  expect(wrapper.findAll("path")).toHaveLength(128);
  expect(wrapper.find("svg").attributes("width")).toBe("1804");
  expect(wrapper.find("svg").attributes("viewBox")).toBe("0 0 1804 22");
});

it.each([
  { viewportLeft: 0 },
  { viewportWidth: 210 },
  { viewportLeft: Number.NaN, viewportWidth: 210 },
  { viewportLeft: Number.POSITIVE_INFINITY, viewportWidth: 210 },
  { viewportLeft: 0, viewportWidth: Number.NaN },
  { viewportLeft: 0, viewportWidth: Number.POSITIVE_INFINITY },
  { viewportLeft: 0, viewportWidth: 0 },
  { viewportLeft: 0, viewportWidth: -1 },
])("keeps all paths for incomplete or unusable viewport %j", (viewport) => {
  expect(cell(viewport).findAll("path")).toHaveLength(128);
});

it("renders only intersecting straight lanes while panning left, middle and right", async () => {
  const wrapper = cell({ viewportLeft: 0, viewportWidth: 210 });
  expect(wrapper.findAll("path")).toHaveLength(15);
  await wrapper.setProps({ viewportLeft: 700 });
  expect(wrapper.findAll("path")).toHaveLength(16);
  expect(drawings(wrapper)[0]!.d).toBe("M 699 0 L 699 22");
  await wrapper.setProps({ viewportLeft: 1594 });
  expect(wrapper.findAll("path")).toHaveLength(15);
  expect(drawings(wrapper).at(-1)!.d).toBe("M 1791 0 L 1791 22");
  // The outer clip and transform retain the original coordinate space.
  expect(wrapper.find("svg").attributes("width")).toBe("1804");
  expect(wrapper.find("svg").attributes("viewBox")).toBe("0 0 1804 22");
});

it.each([
  { left: 15, width: 10, count: 1 },
  { left: 15.001, width: 10, count: 0 },
  { left: 0, width: 11, count: 1 },
  { left: 0, width: 10.999, count: 0 },
])("keeps a conservative 2px stroke margin at $left / $width", ({ left, width, count }) => {
  const wrapper = cell({
    graph: { lane: 1, color: 0, edges: [straight(0)] },
    viewportLeft: left,
    viewportWidth: width,
  });
  expect(wrapper.findAll("path")).toHaveLength(count);
});

it("retains forward and reverse crossing curves when neither endpoint is visible", () => {
  const props = {
    graph: {
      lane: 30,
      color: 3,
      edges: [
        { fromLane: 0, toLane: 100 },
        { fromLane: 100, toLane: 0 },
        { fromLane: 0, toLane: 5 },
        { fromLane: 90, toLane: 100 },
        straight(30),
      ],
    },
    edgeColors: [8, 9, 10, 11, 2],
  };
  const full = drawings(cell(props));
  const clipped = drawings(cell({ ...props, viewportLeft: 400, viewportWidth: 200 }));
  expect(clipped).toEqual([full[0], full[1], full[4]]);
  expect(clipped[0]!.d).toBe("M 13 11 C 13 16.5, 1413 16.5, 1413 22");
  expect(clipped[1]!.d).toBe("M 1413 11 C 1413 16.5, 13 16.5, 13 22");
});

it("preserves overlapping path elements when panning and resizing", async () => {
  const wrapper = cell({ viewportLeft: 0, viewportWidth: 42 });
  const original = new Map(
    wrapper.findAll("path").map((path) => [path.attributes("d"), path.element]),
  );
  expect(original.size).toBe(3);
  await wrapper.setProps({ viewportLeft: 28 });
  for (const d of ["M 27 0 L 27 22", "M 41 0 L 41 22"]) {
    expect(wrapper.findAll("path").find((path) => path.attributes("d") === d)!.element).toBe(
      original.get(d),
    );
  }
  expect(wrapper.findAll("path")).toHaveLength(4);
  const overlap = wrapper
    .findAll("path")
    .find((path) => path.attributes("d") === "M 41 0 L 41 22")!.element;
  await wrapper.setProps({ viewportLeft: 0, viewportWidth: 84 });
  expect(wrapper.findAll("path")).toHaveLength(6);
  expect(
    wrapper.findAll("path").find((path) => path.attributes("d") === "M 41 0 L 41 22")!.element,
  ).toBe(overlap);
});

it("preserves through-lane deduplication and original edge colors after filtering", () => {
  const props = {
    graph: {
      lane: 0,
      color: 11,
      edges: [straight(80), straight(1), straight(1), straight(2), straight(0)],
    },
    edgeColors: [9, 3, 7],
  };
  const paths = drawings(cell({ ...props, viewportLeft: 20, viewportWidth: 30 }));
  expect(paths).toEqual([
    { d: "M 27 0 L 27 22", stroke: "rgb(var(--graph-lane-3))" },
    { d: "M 41 0 L 41 22", stroke: "rgb(var(--graph-lane-11))" },
  ]);
});

it("refreshes visible paths, colors and the node when a recycled cell receives another row", async () => {
  const wrapper = cell({ viewportLeft: 20, viewportWidth: 30 });
  expect(drawings(wrapper).map((path) => path.d)).toEqual(["M 27 0 L 27 22", "M 41 0 L 41 22"]);
  await wrapper.setProps({
    graph: {
      lane: 2,
      color: 9,
      edges: [straight(80), { fromLane: 0, toLane: 4 }, straight(2)],
    },
    edgeColors: [1, 7, 8],
  });
  expect(drawings(wrapper)).toEqual([
    { d: "M 13 11 C 13 16.5, 69 16.5, 69 22", stroke: "rgb(var(--graph-lane-7))" },
    { d: "M 41 11 L 41 22", stroke: "rgb(var(--graph-lane-8))" },
  ]);
  expect(wrapper.find("circle").attributes("cx")).toBe("41");
  expect(wrapper.find("circle").attributes("fill")).toBe("rgb(var(--graph-lane-9))");
});

it("keeps the node, incoming line, hidden-parent hint and accessible title outside the viewport", () => {
  const props = {
    ...wideProps(),
    graph: { ...wideProps().graph, lane: 80 },
    incoming: true,
    hiddenParents: ["123456789abcdef", "abcdef0123456789"],
    nodeLabel: "feature/main",
    laneLabels: { 80: "inherited label" },
  };
  const full = cell(props);
  const clipped = cell({ ...props, viewportLeft: 0, viewportWidth: 210 });
  expect(clipped.findAll("path")).toHaveLength(17);
  expect(clipped.find("circle").attributes()).toEqual(full.find("circle").attributes());
  expect(drawings(clipped).slice(-2)).toEqual(drawings(full).slice(-2));
  expect(clipped.find('[stroke-dasharray="2 2"]').text()).toBe(
    "log.hiddenParents:1234567, abcdef0",
  );
  expect(clipped.find("svg").attributes("aria-label")).toBe("feature/main");
  expect(clipped.findAll("title").map((title) => title.text())).toEqual(
    full.findAll("title").map((title) => title.text()),
  );
});

it("uses the configured lane width and row height without changing visible path geometry", () => {
  const wrapper = cell({
    graph: { lane: 0, color: 0, edges: [straight(0), straight(1), straight(2)] },
    laneWidth: 20,
    rowHeight: 30,
    viewportLeft: 40,
    viewportWidth: 20,
  });
  expect(drawings(wrapper)).toEqual([{ d: "M 56 0 L 56 30", stroke: "rgb(var(--graph-lane-2))" }]);
  expect(wrapper.find("circle").attributes("cy")).toBe("15");
});
