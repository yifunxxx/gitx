import { beforeEach, expect, it, vi } from "vitest";
import { chooseOpenProjectTarget } from "./useOpenProjectChoice";

const m = vi.hoisted(() => ({ dialog: vi.fn() }));
vi.mock("./useDialog", () => ({ openDialog: m.dialog }));

beforeEach(() => {
  vi.resetAllMocks();
  m.dialog.mockResolvedValue("here");
});

it("opens in this window when no project is loaded", async () => {
  await expect(
    chooseOpenProjectTarget({ currentPath: null, nextPath: "B" }),
  ).resolves.toBe("here");
  expect(m.dialog).not.toHaveBeenCalled();
});

it("skips the prompt when the path is already open", async () => {
  await expect(
    chooseOpenProjectTarget({ currentPath: "D:\\Work\\App", nextPath: "d:/Work/App" }),
  ).resolves.toBe("here");
  expect(m.dialog).not.toHaveBeenCalled();
});

it("asks when switching to another project", async () => {
  m.dialog.mockResolvedValueOnce("new");
  await expect(
    chooseOpenProjectTarget({ currentPath: "A", nextPath: "B" }),
  ).resolves.toBe("new");
  expect(m.dialog).toHaveBeenCalledOnce();
});

it("honors preferNewWindow without prompting", async () => {
  await expect(
    chooseOpenProjectTarget({ currentPath: "A", nextPath: "B", preferNewWindow: true }),
  ).resolves.toBe("new");
  expect(m.dialog).not.toHaveBeenCalled();
});

it("treats cancel as null", async () => {
  m.dialog.mockResolvedValueOnce(null);
  await expect(
    chooseOpenProjectTarget({ currentPath: "A", nextPath: "B" }),
  ).resolves.toBeNull();
});
