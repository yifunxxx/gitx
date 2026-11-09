import { describe, expect, it } from "vitest";
import { buildRefTree, flattenRefTree } from "./buildRefTree";

describe("buildRefTree", () => {
  it("returns flat list when grouping off", () => {
    const tree = buildRefTree(["main", "feature/a"], false);
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.kind === "ref")).toBe(true);
  });

  it("groups by directory", () => {
    const tree = buildRefTree(["main", "feature/a", "feature/b", "bugfix/x"], true);
    const feature = tree.find((n) => n.label === "feature");
    expect(feature?.kind).toBe("folder");
    expect(feature?.children?.map((c) => c.label).sort()).toEqual(["a", "b"]);
    expect(tree.some((n) => n.refName === "main")).toBe(true);
  });

  it("keeps nested folder paths, depth and duplicate leaf labels distinct", () => {
    const rows = flattenRefTree(buildRefTree(["feature/ui/button", "feature/api/button", "main"], true));
    expect(rows.map(({ id, depth }) => [id, depth])).toEqual([
      ["feature", 0], ["feature/api", 1], ["feature/api/button", 2],
      ["feature/ui", 1], ["feature/ui/button", 2], ["main", 0],
    ]);
    expect(rows.filter((row) => row.label === "button").map((row) => row.refName))
      .toEqual(["feature/api/button", "feature/ui/button"]);
  });

  it("renders all leaves in a large directory hierarchy without duplicating them", () => {
    const names = Array.from({ length: 2000 }, (_, i) => `team${i % 8}/feature${i % 13}/topic${i}`);
    const rows = flattenRefTree(buildRefTree(names, true));
    const rendered = rows.filter((row) => row.kind === "ref").map((row) => row.refName);
    expect(rendered).toHaveLength(names.length);
    expect(new Set(rendered)).toEqual(new Set(names));
    expect(rows.filter((row) => row.kind === "folder")).toHaveLength(8 + 8 * 13);
  });
});
