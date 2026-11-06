<script setup lang="ts">
import {
  Check,
  FolderOpen,
  GitBranch,
  History,
  Menu,
  RotateCcw,
  Search,
  Settings,
  Upload,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import WindowControls from "./WindowControls.vue";
import { useLayoutStore } from "@/stores/layoutStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { runAction, getAction } from "@/actions";
import type { ActionContext } from "@/actions";
import { computed } from "vue";
import { isTauri } from "@/lib/utils";
import { toast } from "@/composables/useToast";

const layout = useLayoutStore();
const workspace = useWorkspaceStore();

const ctx = computed<ActionContext>(() => ({
  repoIds: workspace.toplevel ? [workspace.toplevel] : [],
  selection: {},
  source: "toolbar",
  place: "MainToolbar",
  folderPath: workspace.folderPath,
}));

async function openFolder() {
  let path: string | null = null;
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    path = typeof selected === "string" ? selected : null;
  } else {
    path = window.prompt("Folder path (web mock)", workspace.folderPath ?? "/tmp") || null;
  }
  if (!path) return;
  await workspace.openFolder(path);
  toast({ title: "Folder opened", description: path });
  await runAction("Git.RefreshStatus", { ...ctx.value, folderPath: path, source: "toolbar" });
}

async function run(id: string, source: ActionContext["source"] = "toolbar") {
  await runAction(id, { ...ctx.value, source, place: source });
}

const demo = computed(() => getAction("Git.Demo.Hello"));
</script>

<template>
  <header
    class="flex h-10 shrink-0 items-center gap-1 border-b bg-dbx-chrome px-2"
    data-tauri-drag-region
  >
    <Button variant="ghost" size="icon" class="shrink-0" @click="layout.vcsPopupOpen = true">
      <Menu class="h-4 w-4" />
    </Button>

    <Button variant="ghost" size="sm" class="gap-1.5" @click="openFolder">
      <FolderOpen class="h-3.5 w-3.5" />
      <span class="max-w-[160px] truncate">
        {{ workspace.folderPath ? workspace.folderPath.split(/[\\/]/).pop() : "Open Folder" }}
      </span>
    </Button>

    <div
      class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground"
      title="VCS Widget placeholder"
    >
      <GitBranch class="h-3.5 w-3.5" />
      <span>{{ workspace.isRepo ? "main" : "—" }}</span>
    </div>

    <div class="flex-1" data-tauri-drag-region />

    <div class="flex items-center gap-0.5">
      <Button variant="ghost" size="sm" title="Update (stub)">
        <RotateCcw class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" title="Commit (stub)">
        <Check class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" title="Push (stub)">
        <Upload class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" title="History (stub)">
        <History class="h-3.5 w-3.5" />
      </Button>
      <Button
        v-if="demo"
        variant="ghost"
        size="sm"
        :title="demo.title"
        @click="run('Git.Demo.Hello', 'menu')"
      >
        Demo
      </Button>
      <Button variant="ghost" size="icon" title="Find Action" @click="layout.findActionOpen = true">
        <Search class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" title="Settings (stub)">
        <Settings class="h-3.5 w-3.5" />
      </Button>
    </div>

    <WindowControls />
  </header>
</template>
