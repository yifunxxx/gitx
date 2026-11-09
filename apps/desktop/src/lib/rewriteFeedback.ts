import type { RewriteResult } from "@/lib/backend";
import { i18n } from "@/i18n";

export type RewriteOperation =
  | "merge"
  | "rebase"
  | "cherryPick"
  | "reword"
  | "squash"
  | "drop"
  | "fixup"
  | "squashInto"
  | "uncommit"
  | "revert"
  | "reset"
  | "extract"
  | "dropChanges"
  | "abort";

export function rewriteResultTitle(result: RewriteResult, operation: RewriteOperation): string {
  const t = i18n.global.t;
  switch (result.outcome) {
    case "conflicts":
      return result.conflictFiles.length
        ? t("merge.filesConflicted", { count: result.conflictFiles.length })
        : t(operation === "merge" ? "rewrite.results.mergeStaged" : "merge.paused");
    case "alreadyUpToDate":
      return t("rewrite.results.alreadyUpToDate");
    case "fastForward":
      return t("rewrite.results.fastForward");
    case "nothingToCommit":
      return t(
        operation === "merge" ? "rewrite.results.mergeStaged" : "rewrite.results.nothingToCommit",
      );
    case "success":
      return t(`rewrite.completed.${operation}`);
  }
}
