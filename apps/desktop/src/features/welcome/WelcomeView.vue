<script setup lang="ts">
import { Download, FolderGit2, FolderOpen, GitBranchPlus, LoaderCircle } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceOpen } from "@/composables/useWorkspaceOpen";
import { runAction } from "@/actions";

const { t } = useI18n();
const workspace = useWorkspaceStore();
const { pending, pendingPath, error, openFolder, openRecent, createRepo } = useWorkspaceOpen();

async function cloneRepo() {
  if (pending.value) return;
  await runAction("Git.Clone", {
    repoIds: [],
    selection: {},
    source: "menu",
    place: "Welcome",
  });
}
</script>

<template>
  <div
    class="welcome-root flex h-full min-w-0 flex-col overflow-auto bg-dbx-content p-6"
    :aria-busy="pending"
  >
    <div class="welcome-panel m-auto w-full min-w-0 max-w-3xl shrink-0">
      <div class="mb-8">
        <div class="welcome-brand text-3xl font-semibold tracking-tight">gitx</div>
        <p class="mt-2 max-w-xl text-sm text-muted-foreground">
          {{ t("welcome.tagline") }}
        </p>
      </div>

      <div
        v-if="pending"
        role="status"
        class="mb-4 flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
      >
        <LoaderCircle class="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
        <span class="shrink-0">{{ t("common.loading") }}</span>
        <span v-if="pendingPath" class="truncate font-mono text-xs" :title="pendingPath">{{
          pendingPath
        }}</span>
      </div>
      <p v-if="error" role="alert" class="mb-4 break-words text-sm text-destructive">{{ error }}</p>

      <div class="welcome-columns grid gap-6">
        <div class="min-w-0 space-y-2">
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
            class="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            :title="path"
            :disabled="pending"
            @click="openRecent(path)"
          >
            <FolderGit2 class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="truncate font-mono text-[12px]">{{ path }}</span>
          </button>
        </div>

        <div class="flex min-w-0 flex-col gap-2">
          <Button
            class="justify-start gap-2 transition-transform active:scale-[0.98]"
            size="lg"
            :disabled="pending"
            @click="openFolder"
          >
            <FolderOpen class="h-4 w-4" />
            {{ t("welcome.open") }}
          </Button>
          <Button
            class="justify-start gap-2 transition-transform active:scale-[0.98]"
            size="lg"
            :disabled="pending"
            variant="outline"
            @click="cloneRepo"
          >
            <Download class="h-4 w-4" />
            {{ t("welcome.clone") }}
          </Button>
          <Button
            class="justify-start gap-2 transition-transform active:scale-[0.98]"
            size="lg"
            :disabled="pending"
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
  container-type: inline-size;
  background:
    radial-gradient(1200px 480px at 12% -10%, rgb(var(--accent) / 0.55), transparent 55%),
    radial-gradient(900px 420px at 95% 0%, rgb(var(--info) / 0.08), transparent 50%),
    rgb(var(--dbx-content));
}

.welcome-columns {
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
}

@container (max-width: 580px) {
  .welcome-columns {
    grid-template-columns: minmax(0, 1fr);
  }
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
