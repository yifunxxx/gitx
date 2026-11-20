import { expect, it } from "vitest";
import { cloneDestination, cloneFolderName } from "./cloneDestination";

it.each([
  ["https://git.example.test/team/diss.git", "diss"],
  ["https://host/team/diss.git/?ref=main#readme", "diss"],
  ["ssh://git@host:2222/team/diss.git", "diss"],
  ["git@host:team/diss.git", "diss"],
  ["C:\\source\\diss.git", "diss"],
  ["/home/source/my project/", "my project"],
  ["https://host/team/%E4%BB%93%E5%BA%93.git", "仓库"],
  ["https://host", ""],
  ["https://host/a%2fb.git", ""],
  ["https://host/a%5cb.git", ""],
  ["https://host/CON.git", ""],
])("infers the repository name from %s", (source, expected) => {
  expect(cloneFolderName(source)).toBe(expected);
});

it.each([
  ["E:\\IDEAproject", "diss", "E:\\IDEAproject\\diss"],
  ["E:\\", "diss", "E:\\diss"],
  ["E:/IDEAproject/", "diss", "E:/IDEAproject/diss"],
  ["/", "diss", "/diss"],
  ["\\\\server\\share\\", "diss", "\\\\server\\share\\diss"],
  ["/projects", "my work", "/projects/my work"],
  ["/projects", "..", ""],
  ["/projects", "/elsewhere", ""],
  ["/projects", "nested/repo", ""],
  ["/projects", "diss.", ""],
  ["/projects", "nul.txt", ""],
])("combines parent %s with a single valid child %s", (parent, name, expected) => {
  expect(cloneDestination(parent, name)).toBe(expected);
});
