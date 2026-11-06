<script setup lang="ts">
import { Download, FolderGit2, FolderOpen, GitBranchPlus } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore } from "@/stores/changesStore";
import { useLogStore } from "@/stores/logStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { isTauri } from "@/lib/utils";
import { toast } from "@/composables/useToast";
import { runAction } from "@/actions";

const { t } = useI18n();
const workspace = useWorkspaceStore();
const changes = useChangesStore();
const log = useLogStore();
const layout = useLayoutStore();
const branches = useBranchesStore();

async function pickDirectory(): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  }
  return window.prompt(t("welcome.folderPrompt"), workspace.folderPath ?? "/tmp") || null;
}

async function afterOpen() {
  layout.leftOpen = true;
  layout.bottomOpen = true;
  layout.activeBottomTab = "log";
  if (workspace.isRepo) {
    await changes.refresh();
    await log.load(true);
    await branches.refresh();
  }
}

async function openFolder() {
  const path = await pickDirectory();
  if (!path) return;
  await workspace.openFolder(path);
  toast({ title: t("welcome.opened"), description: path });
  await afterOpen();
}

async function openRecent(path: string) {
  await workspace.openFolder(path);
  await afterOpen();
}

async function createRepo() {
  const path = await pickDirectory();
  if (!path) return;
  await workspace.initRepo(path, "main");
  toast({ title: t("welcome.repoCreated"), description: path });
  await afterOpen();
}

async function cloneRepo() {
  await runAction("Git.Clone", {
    repoIds: [],
    selection: {},
    source: "menu",
    place: "Welcome",
  });
}
</script>

<template>
  <div class="welcome-root flex h-full items-center justify-center bg-dbx-content p-8">
    <div class="welcome-panel w-full max-w-3xl">
      <div class="mb-8">
        <div class="welcome-brand text-3xl font-semibold tracking-tight">gitx</div>
        <p class="mt-2 max-w-xl text-sm text-muted-foreground">
          {{ t("welcome.tagline") }}
        </p>
      </div>

      <div class="grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
        <div class="space-y-2">
          <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {{ t("welcome.recent") }}
          </div>
          <div
            v-if="!workspace.recent.length"
            class="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground"
          >
            {{ t("welcome.noRecent") }}
          </div>
          <button
            v-for="path in workspace.recent"
            :key="path"
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            @click="openRecent(path)"
          >
            <FolderGit2 class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="truncate font-mono text-[12px]">{{ path }}</span>
          </button>
        </div>

        <div class="flex flex-col gap-2">
          <Button class="justify-start gap-2 transition-transform active:scale-[0.98]" size="lg" @click="openFolder">
            <FolderOpen class="h-4 w-4" />
            {{ t("welcome.open") }}
          </Button>
          <Button
            class="justify-start gap-2 transition-transform active:scale-[0.98]"
            size="lg"
            variant="outline"
            @click="cloneRepo"
          >
            <Download class="h-4 w-4" />
            {{ t("welcome.clone") }}
          </Button>
          <Button
            class="justify-start gap-2 transition-transform active:scale-[0.98]"
            size="lg"
            variant="outline"
            @click="createRepo"
          >
            <GitBranchPlus class="h-4 w-4" />
            {{ t("welcome.create") }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome-root {
  background:
    radial-gradient(1200px 480px at 12% -10%, rgb(var(--accent) / 0.55), transparent 55%),
    radial-gradient(900px 420px at 95% 0%, rgb(var(--info) / 0.08), transparent 50%),
    rgb(var(--dbx-content));
}

.welcome-panel {
  animation: welcome-in 220ms ease-out;
}

.welcome-brand {
  letter-spacing: -0.02em;
}

@keyframes welcome-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-panel {
    animation: none;
  }
}
</style>
