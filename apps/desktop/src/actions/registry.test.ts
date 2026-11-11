import { beforeEach, describe, expect, it } from "vitest";
import { bootstrapActions, getAction, searchActions } from "./index";
import type { ActionContext } from "./types";
import { resolveActionTitle } from "./titles";
import { i18n } from "@/i18n";

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

  it("searches the displayed Chinese title while retaining English and action-id search", () => {
    const previous = i18n.global.locale.value;
    i18n.global.locale.value = "zh-CN";
    try {
      const title = (action: NonNullable<ReturnType<typeof getAction>>) =>
        resolveActionTitle(action, (key) => i18n.global.t(key));
      expect(searchActions("工作树", ctx, title).some((a) => a.id === "Git.Show.WorkingTrees")).toBe(
        true,
      );
      expect(searchActions("提交合并", ctx, title).some((a) => a.id === "Git.Merge.Commit")).toBe(
        true,
      );
      expect(searchActions("settings", ctx, title).some((a) => a.id === "Settings")).toBe(true);
      expect(
        searchActions("git.merge.commit", ctx, title).some((a) => a.id === "Git.Merge.Commit"),
      ).toBe(true);
    } finally {
      i18n.global.locale.value = previous;
    }
  });
});
