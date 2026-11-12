import { nextTick } from "vue";
import { useLayoutStore } from "@/stores/layoutStore";

/** Ensure the Commit tool window + message box are visible, then focus the message. */
export async function focusCommitUi(): Promise<void> {
  const layout = useLayoutStore();
  if (layout.commitTwMode !== "float") {
    layout.leftOpen = true;
  }
  layout.commitControlsHidden = false;
  await nextTick();
  const el = document.querySelector<HTMLTextAreaElement>("[data-gitx-commit-message]");
  el?.focus({ preventScroll: true });
}
