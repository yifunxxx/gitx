<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import WorkspacePanels from "@/components/layout/WorkspacePanels.vue";
import "splitpanes/dist/splitpanes.css";
import TitleBar from "@/components/layout/TitleBar.vue";
import ToolWindowStripe from "@/components/layout/ToolWindowStripe.vue";
import CommitToolWindow from "@/components/layout/CommitToolWindow.vue";
import FileToolWindow from "@/components/layout/FileToolWindow.vue";
import EditorTabs from "@/components/layout/EditorTabs.vue";
import GitToolWindow from "@/components/layout/GitToolWindow.vue";
import StatusBar from "@/components/layout/StatusBar.vue";
import JobsPopup from "@/components/layout/JobsPopup.vue";
import FindActionPalette from "@/components/layout/FindActionPalette.vue";
import VcsOperationsPopup from "@/components/layout/VcsOperationsPopup.vue";
import CustomContextMenuHost from "@/components/layout/CustomContextMenuHost.vue";
import ToastHost from "@/components/common/ToastHost.vue";
import DialogHost from "@/components/common/DialogHost.vue";
import BranchesPopup from "@/features/branches/BranchesPopup.vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLayoutStore } from "@/stores/layoutStore";
import { useFileTreeStore } from "@/stores/fileTreeStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUpdateStore } from "@/stores/updateStore";
import { useConsoleStore } from "@/stores/consoleStore";
import {
  findActionIdByEvent,
  isShortcutEvent,
  matchShortcut,
  runAction,
  setKeymapOverridesProvider,
} from "@/actions";
import { formatErrorMessage, formatGitDetectError } from "@/lib/errors";
import { toast } from "@/composables/useToast";
import { i18n } from "@/i18n";

import { useAppEvents } from "@/composables/useAppEvents";
import { useRepositoryRefresh } from "@/composables/useRepositoryRefresh";
import { useAutoFetch } from "@/composables/useAutoFetch";
import { useWindowTitle } from "@/composables/useWindowTitle";
import { createWorkspaceOpen } from "@/composables/useWorkspaceOpen";
import { getBackend } from "@/lib/backend";
import { isTerminalToggle } from "@/features/terminal/terminalShortcut";
import { installLongTaskLogging } from "@/lib/longTaskLog";
import { isTauri } from "@/lib/utils";

useRepositoryRefresh(() => useFileTreeStore().refreshExpanded());
useWindowTitle();
const stopLongTaskLog = installLongTaskLogging();
const layout = useLayoutStore();
const leftDockVisible = computed(
  () => layout.leftOpen && (layout.activeLeftTab === "file" || layout.commitTwMode !== "float"),
);
function leftResized(payload: { event?: Event; panes: { size: number }[] }) {
  if (payload.event && leftDockVisible.value && payload.panes[0]) {
    layout.leftSize = Math.min(50, Math.max(16, payload.panes[0].size));
  }
}
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const updates = useUpdateStore();
const consoleStore = useConsoleStore();
useAppEvents();
useAutoFetch();

const releaseKeymap = setKeymapOverridesProvider(() => settings.settings?.keymapOverrides);

let disposed = false;

function onKeydown(e: KeyboardEvent) {
  if (!isShortcutEvent(e)) return;
  // Don't steal keys while typing in inputs / dialogs (except Find Action).
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName?.toLowerCase();
  if (isTerminalToggle(e) && e.ctrlKey !== e.metaKey && !target?.closest("[role='dialog']")) {
    e.preventDefault();
    layout.bottomOpen = !(layout.bottomOpen && layout.activeBottomTab === "terminal");
    layout.activeBottomTab = "terminal";
    return;
  }
  const editing =
    tag === "input" ||
    tag === "textarea" ||
    target?.isContentEditable ||
    target?.closest("[role='dialog']");

  if (matchShortcut(e, "ctrl+shift+a") || matchShortcut(e, "meta+shift+a")) {
    e.preventDefault();
    layout.findActionOpen = true;
    return;
  }
  const id = findActionIdByEvent(e);
  // Settings and Save must reach CodeMirror / contentEditable hosts (Ctrl/Cmd+S).
  const toolWindowAction =
    id === "ToolWindow.ShowFile" ||
    id === "ToolWindow.ShowCommit" ||
    id === "File.GoToFile" ||
    id === "File.FindInFiles" ||
    id === "File.ReplaceInFiles" ||
    (id?.startsWith("Editor.") && !!target?.closest(".cm-editor"));
  if (
    editing &&
    id !== "Settings" &&
    id !== "File.Save" &&
    !(toolWindowAction && !target?.closest("[role='dialog']"))
  )
    return;
  if (!id) return;
  e.preventDefault();
  void runAction(id, {
    repoIds: workspace.toplevel ? [workspace.toplevel] : [],
    selection: {},
    source: "shortcut",
    place: "global",
    folderPath: workspace.folderPath,
  });
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  // Schedule update auto-check immediately — do not wait on settings/Git detect,
  // which can hang or throw and previously prevented startAutoChecks entirely.
  updates.startAutoChecks();
  try {
    await settings.load();
  } catch (err) {
    if (!disposed) {
      consoleStore.append("stderr", formatErrorMessage(err));
    }
  }
  if (disposed) return;
  // Git detection depends on settings, not on the recent-project menu.
  void workspace.loadRecent();
  try {
    await workspace.detectGit();
    if (disposed) return;
    consoleStore.append("cmd", `# git detected: ${workspace.gitPath}`);
    consoleStore.append("stdout", workspace.gitVersion ?? "");
  } catch (err) {
    if (disposed) return;
    const msg = formatGitDetectError(err, i18n.global.t("git.detectHint"));
    consoleStore.append("stderr", msg);
    toast({
      title: i18n.global.t("git.detectFail"),
      description: msg,
      persistent: true,
      action: {
        label: i18n.global.t("git.openSettings"),
        onClick: () => {
          void runAction("Settings", {
            repoIds: [],
            selection: {},
            source: "popup",
            place: "GitDetect",
          });
        },
      },
    });
  }
  if (disposed || !isTauri()) return;
  // New-window launches pass `--open <path>`; consume once after startup.
  try {
    const startupPath = await getBackend().appStartupOpenPath();
    if (disposed || !startupPath || workspace.folderPath) return;
    await createWorkspaceOpen((key) => String(i18n.global.t(key))).openRecent(startupPath);
  } catch (err) {
    if (!disposed) {
      toast({ title: formatErrorMessage(err) });
    }
  }
});

onUnmounted(() => {
  disposed = true;
  updates.stopAutoChecks();
  stopLongTaskLog();
  releaseKeymap();
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <TooltipProvider :delay-duration="350" :skip-delay-duration="200">
    <div class="glass-shell app-no-drag flex h-full min-h-0 flex-col overflow-hidden">
      <TitleBar />
      <div class="app-no-drag flex min-h-0 flex-1">
        <ToolWindowStripe />
        <div class="glass-workspace app-no-drag min-h-0 min-w-0 flex-1">
          <WorkspacePanels>
            <template #editor>
              <Splitpanes
                class="editor-panels h-full"
                :class="{ 'editor-panels-single': !leftDockVisible }"
                :maximize-panes="false"
                @resized="leftResized"
              >
                <Pane
                  :size="leftDockVisible ? layout.leftSize : 0"
                  :min-size="leftDockVisible ? 16 : 0"
                  :max-size="leftDockVisible ? 50 : 0"
                  :aria-hidden="!leftDockVisible || undefined"
                  :inert="!leftDockVisible || undefined"
                >
                  <div v-show="leftDockVisible" class="h-full min-h-0">
                    <CommitToolWindow
                      v-if="layout.commitTwMode !== 'float'"
                      v-show="layout.activeLeftTab === 'commit'"
                    />
                    <FileToolWindow v-show="layout.activeLeftTab === 'file'" />
                  </div>
                </Pane>
                <Pane :size="leftDockVisible ? 100 - layout.leftSize : 100" min-size="30">
                  <EditorTabs />
                </Pane>
              </Splitpanes>
            </template>
            <template #git><GitToolWindow /></template>
          </WorkspacePanels>
        </div>
      </div>
      <!-- Float mode: in-app panel only — never a second OS / Webview window. -->
      <div
        v-if="layout.commitTwMode === 'float'"
        v-show="layout.activeLeftTab === 'commit'"
        class="pointer-events-none fixed inset-x-4 bottom-12 top-14 z-40 flex justify-start"
      >
        <div
          class="pointer-events-auto flex h-full w-[min(420px,42vw)] min-w-[280px] flex-col overflow-hidden rounded-md border bg-sidebar shadow-lg ring-1 ring-foreground/10"
        >
          <CommitToolWindow />
        </div>
      </div>
      <StatusBar />
      <JobsPopup />
      <FindActionPalette />
      <VcsOperationsPopup />
      <CustomContextMenuHost />
      <ToastHost />
      <DialogHost />
      <BranchesPopup />
    </div>
  </TooltipProvider>
</template>

<style>
.editor-panels-single > .splitpanes__splitter {
  display: none;
}
.editor-panels > .splitpanes__pane {
  transition: none;
}
/* Override splitpanes default-theme hard-coded #f2f2f2 / #fff so dark mode
   does not leave light "islands" in Log / nested panes (GIT-37). */
.default-theme.splitpanes .splitpanes__pane {
  background-color: rgb(var(--background));
}
.default-theme.splitpanes .splitpanes__splitter {
  background-color: rgb(var(--border));
  border-color: rgb(var(--border)) !important;
}
.default-theme.splitpanes .splitpanes__splitter:hover {
  background-color: rgb(var(--ring));
}
.default-theme.splitpanes .splitpanes__splitter:before,
.default-theme.splitpanes .splitpanes__splitter:after,
.default-theme .splitpanes .splitpanes__splitter:before,
.default-theme .splitpanes .splitpanes__splitter:after {
  background-color: rgb(var(--muted-foreground) / 0.35);
}
.default-theme.splitpanes .splitpanes__splitter:hover:before,
.default-theme.splitpanes .splitpanes__splitter:hover:after,
.default-theme .splitpanes .splitpanes__splitter:hover:before,
.default-theme .splitpanes .splitpanes__splitter:hover:after {
  background-color: rgb(var(--muted-foreground) / 0.55);
}
</style>
