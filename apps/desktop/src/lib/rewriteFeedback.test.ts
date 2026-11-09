import { afterEach, expect, it } from "vitest";
import { i18n } from "@/i18n";
import type { RewriteResult } from "@/lib/backend";
import { rewriteResultTitle } from "./rewriteFeedback";

const result: RewriteResult = {
  oldHead: "before",
  newHead: "after",
  outcome: "success",
  message: "Unlocalized backend text",
  conflictFiles: [],
  backupRef: null,
};
afterEach(() => {
  i18n.global.locale.value = "zh-CN";
});

it("describes pending merge and edit states without claiming completion", () => {
  i18n.global.locale.value = "zh-CN";
  expect(rewriteResultTitle({ ...result, outcome: "nothingToCommit" }, "merge")).toBe(
    "合并更改已暂存，请完成提交",
  );
  expect(rewriteResultTitle({ ...result, outcome: "conflicts" }, "merge")).toBe(
    "合并更改已暂存，请完成提交",
  );
  expect(rewriteResultTitle({ ...result, outcome: "conflicts" }, "rebase")).toBe(
    i18n.global.t("merge.paused"),
  );
  expect(
    rewriteResultTitle({ ...result, outcome: "conflicts", conflictFiles: ["a", "b"] }, "merge"),
  ).toBe(i18n.global.t("merge.filesConflicted", { count: 2 }));
});

it("uses the outcome instead of a success-sounding backend message", () => {
  const noChange = { ...result, message: "Rebase completed", outcome: "alreadyUpToDate" as const };
  expect(rewriteResultTitle(noChange, "rebase")).toContain("无需改写");
  expect(rewriteResultTitle({ ...result, outcome: "nothingToCommit" }, "fixup")).toBe(
    "没有可提交的更改",
  );
});

it("follows the selected language and retains the local-content explanation", () => {
  expect(rewriteResultTitle(result, "dropChanges")).toContain("本地内容已保留");
  i18n.global.locale.value = "en";
  expect(rewriteResultTitle(result, "dropChanges")).toContain("local contents preserved");
  expect(rewriteResultTitle(result, "reword")).toBe("Commit message updated");
});
