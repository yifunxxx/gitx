import { Settings } from "@lucide/vue";
import { registerAction } from "../registry";
import { openDialog } from "@/composables/useDialog";
import SettingsDialog from "@/features/settings/SettingsDialog.vue";

export function registerSettingsActions() {
  registerAction({
    id: "Settings",
    title: "Settings…",
    description: "Open Settings",
    icon: Settings,
    defaultShortcuts: {
      mac: ["mod+,"],
      win: ["mod+,"],
      linux: ["mod+,"],
    },
    scope: "global",
    async run() {
      await openDialog(SettingsDialog);
    },
  });
}
