import { expect, it } from "vitest";
import { activeFileDrag, currentFileDrag, endFileDrag, validFileDrop } from "./fileDrag";

it("rejects self, descendant and no-op moves while respecting Windows path case", () => {
  expect(validFileDrop(["src"], "src/child", false, "C:/project")).toBe(false);
  expect(validFileDrop(["src"], "SRC", true, "C:/project")).toBe(false);
  expect(validFileDrop(["src/a"], "src", false, "C:/project")).toBe(false);
  expect(validFileDrop(["src/a"], "target", false, "C:/project")).toBe(true);
  expect(validFileDrop(["src/a"], "", false, "C:/project")).toBe(true);
});
it("accepts only an active drag from this workspace generation", () => {
  activeFileDrag.value = { folder: "C:/p", paths: ["a"], navigation: 1, applied: 1 };
  expect(currentFileDrag("C:/p", 1, 1)?.paths).toEqual(["a"]);
  expect(currentFileDrag("C:/p", 2, 1)).toBeNull();
  expect(currentFileDrag("C:/other", 1, 1)).toBeNull();
  endFileDrag();
  expect(currentFileDrag("C:/p", 1, 1)).toBeNull();
});
