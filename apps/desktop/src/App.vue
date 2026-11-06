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

const layout = useLayoutStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const consoleStore = useConsoleStore();
const jobs = useJobsStore();

setKeymapOverridesProvider(() => settings.settings?.keymapOverrides);

const unlisteners: Array<() => void> = [];

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

let stuckTimer: number | undefined;

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  await settings.load();
  await workspace.loadRecent();
  try {
    await workspace.detectGit();
    consoleStore.append("cmd", `# git detected: ${workspace.gitPath}`);
    consoleStore.append("stdout", workspace.gitVersion ?? "");
  } catch (err) {
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

  stuckTimer = window.setInterval(() => jobs.pruneStuck(), 30_000);

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
  if (stuckTimer != null) window.clearInterval(stuckTimer);
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
                v-if="layout.leftOpen && layout.commitTwMode !== 'float'"
                :size="layout.leftSize"
                min-size="16"
                max-size="50"
              >
                <CommitToolWindow />
              </Pane>
              <Pane
                :size="
                  layout.leftOpen && layout.commitTwMode !== 'float'
                    ? 100 - layout.leftSize
                    : 100
                "
                min-size="30"
              >
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
</template>

<style>
.splitpanes.default-theme .splitpanes__splitter {
  background: rgb(var(--border));
}
.splitpanes.default-theme .splitpanes__splitter:hover {
  background: rgb(var(--ring));
}
</style>
