import { expect, it } from "vitest";
import {
  folderDisplayName,
  formatWindowTitle,
  sameWorkspacePath,
  workspacePathKey,
} from "./workspacePath";

it("normalizes Windows paths case-insensitively", () => {
  expect(workspacePathKey("D:\\gitx\\repo")).toBe("d:/gitx/repo");
  expect(sameWorkspacePath("D:\\gitx\\repo", "d:/gitx/repo")).toBe(true);
});

it("keeps case for POSIX paths", () => {
  expect(workspacePathKey("/Home/Repo")).toBe("/Home/Repo");
  expect(sameWorkspacePath("/Home/Repo", "/home/Repo")).toBe(false);
});

it("formats window titles from the folder basename", () => {
  expect(formatWindowTitle(null)).toBe("gitx");
  expect(formatWindowTitle("")).toBe("gitx");
  expect(formatWindowTitle("D:\\work\\my-app")).toBe("my-app — gitx");
  expect(formatWindowTitle("/tmp/demo/", "gitx")).toBe("demo — gitx");
  expect(folderDisplayName("C:\\Users\\fun\\project")).toBe("project");
});
