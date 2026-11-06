import { beforeEach, describe, expect, it } from "vitest";
import { bootstrapActions, getAction, searchActions } from "./index";
import type { ActionContext } from "./types";

const ctx: ActionContext = {
  repoIds: [],
  selection: {},
  source: "palette",
  place: "test",
  folderPath: "/tmp",
};

describe("action registry", () => {
  beforeEach(() => {
    bootstrapActions();
  });

  it("registers Settings and RefreshStatus", () => {
    expect(getAction("Settings")?.title).toContain("Settings");
    expect(getAction("Git.RefreshStatus")).toBeTruthy();
  });

  it("finds actions by query", () => {
    const hits = searchActions("settings", ctx);
    expect(hits.some((a) => a.id === "Settings")).toBe(true);
  });
});
