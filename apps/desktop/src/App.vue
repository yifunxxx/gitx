<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import "splitpanes/dist/splitpanes.css";
import TitleBar from "@/components/layout/TitleBar.vue";
import ToolWindowStripe from "@/components/layout/ToolWindowStripe.vue";
import CommitToolWindow from "@/components/layout/CommitToolWindow.vue";
import EditorTabs from "@/components/layout/EditorTabs.vue";
import GitToolWindow from "@/components/layout/GitToolWindow.vue";
import StatusBar from "@/components/layout/StatusBar.vue";
import FindActionPalette from "@/components/layout/FindActionPalette.vue";
import VcsOperationsPopup from "@/components/layout/VcsOperationsPopup.vue";
import CustomContextMenuHost from "@/components/layout/CustomContextMenuHost.vue";
import ToastHost from "@/components/common/ToastHost.vue";
import DialogHost from "@/components/common/DialogHost.vue";
import BranchesPopup from "@/features/branches/BranchesPopup.vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLayoutStore } from "@/stores/layoutStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useConsoleStore } from "@/stores/consoleStore";
import { useJobsStore } from "@/stores/jobsStore";
import { findActionIdByEvent, runAction, setKeymapOverridesProvider } from "@/actions";
import { isTauri } from "@/lib/utils";
import { formatGitDetectError } from "@/lib/errors";
import { toast } from "@/composables/useToast";
import { i18n } from "@/i18n";
import { useRepositoryRefresh } from "@/composables/useRepositoryRefresh";

const layout = useLayoutStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const consoleStore = useConsoleStore();
const jobs = useJobsStore();
useRepositoryRefresh();

setKeymapOverridesProvider(() => settings.settings?.keymapOverrides);

const unlisteners: Array<() => void> = [];
let disposed = false;

function keepListener(unlisten: () => void) {
  if (disposed) unlisten();
  else unlisteners.push(unlisten);
}

function onKeydown(e: KeyboardEvent) {
  // Don't steal keys while typing in inputs / dialogs (except Find Action).
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName?.toLowerCase();
  const editing =
    tag === "input" ||
    tag === "textarea" ||
    target?.isContentEditable ||
    target?.closest("[role='dialog']");

  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
    e.preventDefault();
    layout.findActionOpen = true;
    return;
  }
  if (editing && !(e.key === "," && (e.metaKey || e.ctrlKey))) return;

  const id = findActionIdByEvent(e);
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

function onConsoleLine(payload: { stream: string; line: string }) {
  const stream = payload.stream as "cmd" | "stdout" | "stderr";
  consoleStore.append(stream, payload.line);
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  if (isTauri()) {
    const { listen } = await import("@tauri-apps/api/event");
    if (disposed) return;
    // Register each cleanup as soon as it resolves: unmount may happen while
    // another native subscription is still being established.
    await Promise.all([
      listen<{ stream: string; line: string }>("console://line", (e) => {
        if (!disposed) onConsoleLine(e.payload);
      }).then(keepListener),
      listen<{ id: string; title?: string }>("job://started", (e) => {
        if (!disposed) jobs.started({ id: e.payload.id, title: e.payload.title ?? "job" });
      }).then(keepListener),
      listen<{ id: string }>("job://finished", (e) => {
        if (!disposed) jobs.finished(e.payload.id);
      }).then(keepListener),
    ]).catch((err) => consoleStore.append("stderr", String(err)));
  } else {
    const handler = (e: Event) => onConsoleLine((e as CustomEvent).detail);
    window.addEventListener("console://line", handler);
    keepListener(() => window.removeEventListener("console://line", handler));
  }
  if (disposed) return;
  await settings.load();
  if (disposed) return;
  await workspace.loadRecent();
  if (disposed) return;
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
});

onUnmounted(() => {
  disposed = true;
  window.removeEventListener("keydown", onKeydown);
  unlisteners.splice(0).forEach((u) => u());
});
</script>

<template>
  <TooltipProvider :delay-duration="350" :skip-delay-duration="200">
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <TitleBar />
      <div class="flex min-h-0 flex-1">
        <ToolWindowStripe />
        <div class="min-h-0 min-w-0 flex-1">
          <Splitpanes class="default-theme h-full" horizontal>
            <Pane
              v-if="!layout.bottomOpen || !layout.bottomMaximized"
              :size="layout.bottomOpen ? 100 - layout.bottomSize : 100"
              min-size="20"
            >
              <Splitpanes class="h-full">
                <Pane
                  v-if="layout.leftOpen && layout.commitTwMode !== 'float'"
                  :size="layout.leftSize"
                  min-size="16"
                  max-size="50"
                >
                  <CommitToolWindow />
                </Pane>
                <Pane
                  :size="
                    layout.leftOpen && layout.commitTwMode !== 'float' ? 100 - layout.leftSize : 100
                  "
                  min-size="30"
                >
                  <EditorTabs />
                </Pane>
              </Splitpanes>
            </Pane>
            <Pane
              v-if="layout.bottomOpen"
              :size="layout.bottomMaximized ? 100 : layout.bottomSize"
              min-size="15"
              :max-size="layout.bottomMaximized ? 100 : 80"
            >
              <GitToolWindow />
            </Pane>
          </Splitpanes>
        </div>
      </div>
      <!-- Float mode: in-app panel only — never a second OS / Webview window. -->
      <div
        v-if="layout.commitTwMode === 'float'"
        class="pointer-events-none fixed inset-x-4 bottom-12 top-14 z-40 flex justify-start"
      >
        <div
          class="pointer-events-auto flex h-full w-[min(420px,42vw)] min-w-[280px] flex-col overflow-hidden rounded-md border bg-sidebar shadow-lg ring-1 ring-foreground/10"
        >
          <CommitToolWindow />
        </div>
      </div>
      <StatusBar />
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
