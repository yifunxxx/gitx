import { expect, it } from "vitest";
import { changeLocation } from "./changeLocation";

it("uses a file's parent and a folder itself without interpreting shell characters", () => {
  expect(changeLocation("C:\\repo with space", "src/O'Brien & $x/file.txt", false)).toEqual({
    path: "C:/repo with space/src/O'Brien & $x/file.txt",
    cwd: "C:/repo with space/src/O'Brien & $x",
  });
  expect(changeLocation("C:/repo/", "src/nested", true).cwd).toBe("C:/repo/src/nested");
  expect(changeLocation("C:/repo/", "new/cache/", true)).toEqual({
    path: "C:/repo/new/cache",
    cwd: "C:/repo/new/cache",
  });
  expect(changeLocation("C:/", "file.txt", false).cwd).toBe("C:/");
  expect(changeLocation("/", "file.txt", false).cwd).toBe("/");
  expect(changeLocation("\\\\server\\share", "dir/file.txt", false).cwd).toBe("//server/share/dir");
});

it.each(["../outside", "a/../../outside", "/outside", "C:/outside", "a/./b", "a//b", "a\0b"])(
  "rejects an invalid repository path %s",
  (path) => expect(() => changeLocation("C:/repo", path, false)).toThrow(),
);
