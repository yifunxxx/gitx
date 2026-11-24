import { defineAsyncComponent } from "vue";
import { openDialog } from "./useDialog";
import { sameWorkspacePath } from "@/lib/workspacePath";

export type OpenProjectTarget = "here" | "new";

const OpenProjectChoiceDialog = defineAsyncComponent(
  () => import("@/features/welcome/OpenProjectChoiceDialog.vue"),
);

/**
 * Decide whether to replace the current window or spawn a new one.
 * Welcome (no folder) opens in-place; same path stays here; otherwise ask.
 * `preferNewWindow` skips the prompt (e.g. worktree double-click).
 */
export async function chooseOpenProjectTarget(opts: {
  currentPath: string | null;
  nextPath: string;
  preferNewWindow?: boolean;
}): Promise<OpenProjectTarget | null> {
  if (!opts.currentPath) return "here";
  if (sameWorkspacePath(opts.currentPath, opts.nextPath)) return "here";
  if (opts.preferNewWindow) return "new";
  const choice = await openDialog<OpenProjectTarget | null>(OpenProjectChoiceDialog, {
    currentPath: opts.currentPath,
    nextPath: opts.nextPath,
  });
  return choice ?? null;
}
