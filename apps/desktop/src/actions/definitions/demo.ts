import { Sparkles } from "@lucide/vue";
import { registerAction } from "../registry";
import { useConsoleStore } from "@/stores/consoleStore";
import { toast } from "@/composables/useToast";

export function registerDemoActions() {
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
      consoleStore.append("stdout", "Hello from Action Registry");
      toast({ title: "Demo action", description: "Git.Demo.Hello ran" });
    },
  });
}
