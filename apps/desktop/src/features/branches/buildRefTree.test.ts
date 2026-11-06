import { describe, expect, it } from "vitest";
import { buildRefTree } from "./buildRefTree";

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
});
