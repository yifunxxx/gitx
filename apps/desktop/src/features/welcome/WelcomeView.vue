<script setup lang="ts">
import { Download, FolderGit2, FolderOpen, GitBranchPlus } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore } from "@/stores/changesStore";
import { useLogStore } from "@/stores/logStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { isTauri } from "@/lib/utils";
import { toast } from "@/composables/useToast";
import { runAction } from "@/actions";

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
  return window.prompt("Folder path", workspace.folderPath ?? "/tmp") || null;
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
  toast({ title: "Opened", description: path });
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
  toast({ title: "Repository created", description: path });
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
  <div class="flex h-full items-center justify-center bg-dbx-content p-8">
    <div class="w-full max-w-3xl">
      <div class="mb-8">
        <div class="text-2xl font-semibold tracking-tight">gitx</div>
        <p class="mt-1 text-sm text-muted-foreground">
          IDEA-aligned Git GUI — open, clone, or create a repository to get started.
        </p>
      </div>

      <div class="grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
        <div class="space-y-2">
          <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent
          </div>
          <div
            v-if="!workspace.recent.length"
            class="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground"
          >
            No recent repositories yet
          </div>
          <button
            v-for="path in workspace.recent"
            :key="path"
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            @click="openRecent(path)"
          >
            <FolderGit2 class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="truncate font-mono text-[12px]">{{ path }}</span>
          </button>
        </div>

        <div class="flex flex-col gap-2">
          <Button class="justify-start gap-2" size="lg" @click="openFolder">
            <FolderOpen class="h-4 w-4" />
            Open…
          </Button>
          <Button class="justify-start gap-2" size="lg" variant="outline" @click="cloneRepo">
            <Download class="h-4 w-4" />
            Clone Repository…
          </Button>
          <Button class="justify-start gap-2" size="lg" variant="outline" @click="createRepo">
            <GitBranchPlus class="h-4 w-4" />
            Create Repository…
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
