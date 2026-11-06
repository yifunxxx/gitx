<script setup lang="ts">
import { Bell, GitBranch, LoaderCircle } from "@lucide/vue";
import { useJobsStore } from "@/stores/jobsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const jobs = useJobsStore();
const workspace = useWorkspaceStore();
</script>

<template>
  <footer
    class="flex h-6 shrink-0 items-center gap-3 border-t bg-dbx-chrome px-2 text-[11px] text-muted-foreground"
  >
    <div class="flex items-center gap-1">
      <LoaderCircle v-if="jobs.count" class="h-3 w-3 animate-spin" />
      <span>{{ jobs.count ? `${jobs.count} process(es)` : "Idle" }}</span>
    </div>
    <div class="h-3 w-px bg-border" />
    <div class="flex items-center gap-1">
      <GitBranch class="h-3 w-3" />
      <span>{{ workspace.isRepo ? "main" : "no repo" }}</span>
    </div>
    <div class="flex-1" />
    <div class="flex items-center gap-1">
      <Bell class="h-3 w-3" />
      <span>0</span>
    </div>
  </footer>
</template>
