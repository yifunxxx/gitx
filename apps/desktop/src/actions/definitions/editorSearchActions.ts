import { registerAction } from "../registry";
import { canSearchEditor, runEditorSearch } from "@/features/editor/editorSearch";

export function registerEditorSearchActions() {
  registerAction({
    id: "Editor.Find",
    title: "Find in File",
    titleKey: "editor.find",
    scope: "editor",
    defaultShortcuts: { mac: ["mod+f"], win: ["mod+f"], linux: ["mod+f"] },
    enabled: () => canSearchEditor(),
    async run() {
      runEditorSearch("Editor.Find");
    },
  });
  registerAction({
    id: "Editor.Replace",
    title: "Replace in File",
    titleKey: "editor.replace",
    scope: "editor",
    defaultShortcuts: { mac: ["mod+alt+f"], win: ["mod+h"], linux: ["mod+h"] },
    enabled: () => canSearchEditor(true),
    async run() {
      runEditorSearch("Editor.Replace");
    },
  });
  registerAction({
    id: "Editor.FindNext",
    title: "Find Next",
    titleKey: "editor.findNext",
    scope: "editor",
    defaultShortcuts: { mac: ["f3"], win: ["f3"], linux: ["f3"] },
    enabled: () => canSearchEditor(),
    async run() {
      runEditorSearch("Editor.FindNext");
    },
  });
  registerAction({
    id: "Editor.FindPrevious",
    title: "Find Previous",
    titleKey: "editor.findPrevious",
    scope: "editor",
    defaultShortcuts: { mac: ["shift+f3"], win: ["shift+f3"], linux: ["shift+f3"] },
    enabled: () => canSearchEditor(),
    async run() {
      runEditorSearch("Editor.FindPrevious");
    },
  });
  registerAction({
    id: "Editor.ReplaceNext",
    title: "Replace Current Match",
    titleKey: "editor.replaceNext",
    scope: "editor",
    enabled: () => canSearchEditor(true),
    async run() {
      runEditorSearch("Editor.ReplaceNext");
    },
  });
  registerAction({
    id: "Editor.ReplaceAll",
    title: "Replace All in File",
    titleKey: "editor.replaceAll",
    scope: "editor",
    defaultShortcuts: { mac: ["mod+alt+enter"], win: ["mod+alt+enter"], linux: ["mod+alt+enter"] },
    enabled: () => canSearchEditor(true),
    async run() {
      runEditorSearch("Editor.ReplaceAll");
    },
  });
}
