import { watch } from "vue";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { formatWindowTitle } from "@/lib/workspacePath";
import { isTauri } from "@/lib/utils";

/** Keep the OS window title in sync with the open folder (taskbar / Alt-Tab). */
export function useWindowTitle() {
  const workspace = useWorkspaceStore();

  async function apply(path: string | null) {
    const title = formatWindowTitle(path);
    if (typeof document !== "undefined") document.title = title;
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTitle(title);
    } catch {
      // Web / missing permission: document.title still updates for browser tabs.
    }
  }

  void apply(workspace.folderPath);
  watch(
    () => workspace.folderPath,
    (path) => {
      void apply(path);
    },
  );
}
