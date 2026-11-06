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
import { useLayoutStore } from "@/stores/layoutStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useConsoleStore } from "@/stores/consoleStore";
import { useJobsStore } from "@/stores/jobsStore";
import { findActionIdByEvent, runAction } from "@/actions";
import { isTauri } from "@/lib/utils";

const layout = useLayoutStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const consoleStore = useConsoleStore();
const jobs = useJobsStore();

const unlisteners: Array<() => void> = [];

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
    e.preventDefault();
    layout.findActionOpen = true;
    return;
  }
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
  await settings.load();
  try {
    await workspace.detectGit();
    consoleStore.append("cmd", `# git detected: ${workspace.gitPath}`);
    consoleStore.append("stdout", workspace.gitVersion ?? "");
  } catch (err) {
    consoleStore.append("stderr", err instanceof Error ? err.message : String(err));
  }

  if (isTauri()) {
    const { listen } = await import("@tauri-apps/api/event");
    unlisteners.push(
      await listen<{ stream: string; line: string }>("console://line", (e) =>
        onConsoleLine(e.payload),
      ),
      await listen<{ id: string; title?: string }>("job://started", (e) => {
        jobs.started({ id: e.payload.id, title: e.payload.title ?? "job" });
      }),
      await listen<{ id: string }>("job://finished", (e) => jobs.finished(e.payload.id)),
    );
  } else {
    const handler = (e: Event) => onConsoleLine((e as CustomEvent).detail);
    window.addEventListener("console://line", handler);
    unlisteners.push(() => window.removeEventListener("console://line", handler));
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  unlisteners.splice(0).forEach((u) => u());
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <TitleBar />
    <div class="flex min-h-0 flex-1">
      <ToolWindowStripe />
      <div class="min-h-0 min-w-0 flex-1">
        <Splitpanes class="default-theme h-full" horizontal>
          <Pane :size="layout.bottomOpen ? 100 - layout.bottomSize : 100" min-size="30">
            <Splitpanes class="h-full">
              <Pane
                v-if="layout.leftOpen"
                :size="layout.leftSize"
                min-size="16"
                max-size="50"
              >
                <CommitToolWindow />
              </Pane>
              <Pane :size="layout.leftOpen ? 100 - layout.leftSize : 100" min-size="30">
                <EditorTabs />
              </Pane>
            </Splitpanes>
          </Pane>
          <Pane
            v-if="layout.bottomOpen"
            :size="layout.bottomSize"
            min-size="15"
            max-size="60"
          >
            <GitToolWindow />
          </Pane>
        </Splitpanes>
      </div>
    </div>
    <StatusBar />
    <FindActionPalette />
    <VcsOperationsPopup />
    <CustomContextMenuHost />
    <ToastHost />
    <DialogHost />
  </div>
</template>

<style>
.splitpanes.default-theme .splitpanes__splitter {
  background: rgb(var(--border));
}
.splitpanes.default-theme .splitpanes__splitter:hover {
  background: rgb(var(--ring));
}
</style>
