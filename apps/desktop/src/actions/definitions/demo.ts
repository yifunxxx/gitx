import { RefreshCw, Sparkles } from "@lucide/vue";
import { registerAction } from "../registry";
import { useConsoleStore } from "@/stores/consoleStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { getBackend } from "@/lib/backend";
import { toast } from "@/composables/useToast";

export function registerDemoActions() {
  registerAction({
    id: "Git.RefreshStatus",
    title: "Refresh Status",
    description: "Run git status and show output in Console",
    icon: RefreshCw,
    defaultShortcuts: {
      mac: ["mod+r"],
      win: ["mod+r"],
      linux: ["mod+r"],
    },
    scope: "global",
    async run(ctx) {
      const workspace = useWorkspaceStore();
      const consoleStore = useConsoleStore();
      const path = ctx.folderPath ?? workspace.folderPath;
      if (!path) {
        consoleStore.append("stderr", "No folder open — use Open Folder first");
        return;
      }
      const backend = getBackend();
      await backend.statusProbe({ path });
    },
  });

  registerAction({
    id: "Git.Demo.Hello",
    title: "Demo: Hello gitx",
    description: "Sample action wired to menu, context, shortcut, popup, and Find Action",
    icon: Sparkles,
    defaultShortcuts: {
      mac: ["mod+shift+h"],
      win: ["mod+shift+h"],
      linux: ["mod+shift+h"],
    },
    scope: "global",
    async run() {
      const consoleStore = useConsoleStore();
      consoleStore.append("cmd", "# Git.Demo.Hello");
      consoleStore.append("stdout", "Hello from Action Registry (M0 stub)");
      toast({ title: "Demo action", description: "Git.Demo.Hello ran" });
    },
  });
}
