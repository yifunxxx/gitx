import { describe, expect, it } from "vitest";
import { buildPathTree, flattenPathTree } from "./buildPathTree";

describe("buildPathTree", () => {
  it("nests files under folders", () => {
    const tree = buildPathTree([
      { path: "src/main/java/A.java" },
      { path: "src/main/java/B.java" },
      { path: "README.md" },
    ]);
    expect(tree.map((n) => n.name)).toEqual(["src", "README.md"]);
    expect(tree[0]!.kind).toBe("folder");
    const main = tree[0]!.children![0]!;
    expect(main.name).toBe("main");
    const java = main.children![0]!;
    expect(java.children!.map((c) => c.name)).toEqual(["A.java", "B.java"]);
  });

  it("treats trailing-slash paths as directory leaves", () => {
    const tree = buildPathTree([{ path: "target/" }, { path: ".idea/" }]);
    expect(tree.every((n) => n.kind === "folder")).toBe(true);
    expect(tree.map((n) => n.name).sort()).toEqual([".idea", "target"]);
    expect(tree.every((n) => n.file != null && !n.children?.length)).toBe(true);
  });

  it("flattens with collapse", () => {
    const tree = buildPathTree([{ path: "a/b/c.ts" }]);
    const all = flattenPathTree(tree, new Set(), true);
    expect(all.map((r) => r.node.name)).toEqual(["a", "b", "c.ts"]);
    const collapsed = flattenPathTree(tree, new Set(["!a"]), true);
    expect(collapsed.map((r) => r.node.name)).toEqual(["a"]);
  });
});
