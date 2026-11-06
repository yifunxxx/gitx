<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";

const props = defineProps<{
  files: string[];
  operation: string;
}>();

const titleOp =
  props.operation === "rebase"
    ? "rebase"
    : props.operation === "cherry-pick"
      ? "cherry-pick"
      : "merge";
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Local changes would be overwritten by {{ titleOp }}</h2>
      <p class="mt-1 text-xs text-muted-foreground">
        Stash local changes, run the operation, then restore (Smart).
      </p>
      <ul class="mt-3 max-h-48 overflow-auto rounded border text-xs">
        <li v-for="f in files" :key="f" class="border-b px-2 py-1 font-mono last:border-b-0">{{ f }}</li>
        <li v-if="!files.length" class="px-2 py-2 text-muted-foreground">(see Console for file list)</li>
      </ul>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog('cancel')">Cancel</Button>
        <Button variant="outline" size="sm" @click="closeDialog('cancel')">Show Files</Button>
        <Button size="sm" @click="closeDialog('smart')">Smart {{ titleOp === 'merge' ? 'Merge' : titleOp === 'rebase' ? 'Rebase' : 'Cherry-pick' }}</Button>
      </div>
    </div>
  </div>
</template>
