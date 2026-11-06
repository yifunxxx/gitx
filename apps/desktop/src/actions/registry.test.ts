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

  it("registers demo action with IDEA-style id", () => {
    expect(getAction("Git.Demo.Hello")?.title).toContain("Hello");
    expect(getAction("Git.RefreshStatus")).toBeTruthy();
  });

  it("finds actions by query", () => {
    const hits = searchActions("demo", ctx);
    expect(hits.some((a) => a.id === "Git.Demo.Hello")).toBe(true);
  });
});
