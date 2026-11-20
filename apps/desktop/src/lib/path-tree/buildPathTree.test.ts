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

  it("preserves original paths and metadata while sorting directories before files", () => {
    const windowsFile = Object.freeze({
      path: "src\\Nested\\renamed.ts",
      origPath: "old.ts",
      status: "R",
    });
    const folder = Object.freeze({ path: "src/Nested/", directoryLeaf: true, status: "?" });
    const tree = buildPathTree([
      { path: "a.txt", status: "M" },
      windowsFile,
      folder,
      { path: "src/Nested/first.ts", status: "M" },
      { path: "target\\", status: "?" },
      { path: "/src//empty/", status: "?" },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["src", "target", "a.txt"]);
    expect(tree[1]!.file).toEqual({ path: "target\\", status: "?", directoryLeaf: true });
    const src = tree[0]!;
    expect(src.children!.map((node) => node.name)).toEqual(["empty", "Nested"]);
    const nested = src.children![1]!;
    expect(nested.id).toBe("src/Nested");
    expect(nested.file).toEqual(folder);
    expect(nested.children!.map((node) => node.name)).toEqual(["first.ts", "renamed.ts"]);
    expect(nested.children![1]!.id).toBe(windowsFile.path);
    expect(nested.children![1]!.file).toEqual({ ...windowsFile, directoryLeaf: false });
    expect(nested.children![1]!.depth).toBe(2);
  });

  it("keeps distinct Unicode names and the established collation tie order", () => {
    const composed = "é";
    const decomposed = "e\u0301";
    const tree = buildPathTree([
      { path: composed },
      { path: decomposed },
      { path: `dir/${composed}` },
      { path: `dir/${decomposed}` },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["dir", composed, decomposed]);
    expect(tree[0]!.children!.map((node) => node.name)).toEqual([decomposed, composed]);
  });

  it("handles deep paths iteratively and keeps the final metadata for duplicate leaves", () => {
    const path = `${Array.from({ length: 4000 }, () => "d").join("/")}/file.txt`;
    const tree = buildPathTree([
      { path, origPath: "first" },
      { path, origPath: "final" },
    ]);
    const flat = flattenPathTree(tree, new Set());
    expect(flat).toHaveLength(4001);
    expect(flat.at(-1)!.node).toMatchObject({ id: path, depth: 4000, file: { origPath: "final" } });
    expect(flattenPathTree(tree, new Set(["!d"]))).toHaveLength(1);
  });

  it.each([false, true])(
    "keeps file/directory replacements in either input order (reverse=%s)",
    (reverse) => {
      const files = [
        { path: "src/replacement", status: "D", origPath: null },
        { path: "src/replacement/new.txt", status: "A", origPath: "moved.txt" },
        { path: "src/replacement/deep/file.txt", status: "A", origPath: null },
      ];
      const tree = buildPathTree(reverse ? files.slice().reverse() : files);
      const flat = flattenPathTree(tree, new Set());
      expect(flat.flatMap(({ node }) => (node.file ? [node.file.path] : [])).sort()).toEqual(
        files.map((file) => file.path).sort(),
      );
      const siblings = tree[0]!.children!;
      expect(siblings.map((node) => [node.name, node.kind])).toEqual([
        ["replacement", "folder"],
        ["replacement", "file"],
      ]);
      expect(siblings[1]!.file).toMatchObject(files[0]!);
      expect(siblings[1]!.depth).toBe(1);
      expect(
        flattenPathTree(tree, new Set(["!src/replacement"]))
          .map(({ node }) => node.file?.path)
          .filter(Boolean),
      ).toEqual(["src/replacement"]);
    },
  );

  it.each([false, true])(
    "retains a real directory leaf beside a deleted file (reverse=%s)",
    (reverse) => {
      const files = [
        { path: "replacement", status: "D" },
        { path: "replacement/", status: "?" },
      ];
      for (const withChild of [false, true]) {
        const candidates = withChild
          ? [...files, { path: "replacement/child.txt", status: "A" }]
          : files;
        const tree = buildPathTree(reverse ? candidates.slice().reverse() : candidates);
        const flat = flattenPathTree(tree, new Set());
        expect(flat.flatMap(({ node }) => (node.file ? [node.file.path] : [])).sort()).toEqual(
          candidates.map((file) => file.path).sort(),
        );
        expect(tree.map((node) => node.kind)).toEqual(["folder", "file"]);
        expect(tree[0]!.file).toMatchObject(files[1]!);
        expect(tree[1]!.file).toMatchObject(files[0]!);
      }
    },
  );
});
