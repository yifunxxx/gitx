<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";

defineProps<{ message: string }>();
</script>

<template>
  <div class="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Push Rejected</h2>
      <p class="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{{ message }}</p>
      <p class="mt-2 text-xs">Update via rebase or merge, then push again.</p>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(null)">Cancel</Button>
        <Button size="sm" variant="outline" @click="closeDialog('merge')">Merge</Button>
        <Button size="sm" @click="closeDialog('rebase')">Rebase</Button>
      </div>
    </div>
  </div>
</template>
