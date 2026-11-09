import type { SubmoduleUpdateResult } from "@/lib/backend";
import { i18n } from "@/i18n";

export function submoduleFeedback(result: SubmoduleUpdateResult) {
  const updated = result.items.filter((item) => item.updated).length;
  const skipped = result.items.filter((item) => item.skipped).length;
  const failed = result.items.length - updated - skipped;
  return {
    title: i18n.global.t(failed ? "syncUi.submodulesFailed" : "syncUi.submodulesTitle"),
    description: [
      i18n.global.t("syncUi.submodulesSummary", { updated, skipped, failed }),
      ...result.items
        .filter((item) => !item.updated)
        .map((item) => `${item.path}: ${item.message}`),
    ].join("\n"),
    persistent: failed > 0 || skipped > 0,
  };
}
