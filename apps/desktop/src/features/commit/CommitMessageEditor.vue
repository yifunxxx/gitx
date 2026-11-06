<script setup lang="ts">
import { useCommitStore } from "@/stores/commitStore";
import { Button } from "@/components/ui/button";

const commit = useCommitStore();

async function onAmendChange(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  await commit.setAmend(checked);
}
</script>

<template>
  <div class="flex shrink-0 flex-col border-t bg-sidebar">
    <div class="flex items-center gap-3 border-b px-2 py-1.5 text-xs">
      <label class="flex items-center gap-1.5">
        <input
          type="checkbox"
          class="accent-foreground"
          :checked="commit.amend"
          @change="onAmendChange"
        />
        Amend
      </label>
      <label class="flex items-center gap-1.5 text-muted-foreground">
        <input v-model="commit.runHooks" type="checkbox" class="accent-foreground" />
        Run Git hooks
      </label>
    </div>
    <textarea
      v-model="commit.message"
      class="min-h-[88px] resize-none bg-transparent px-2 py-1.5 font-mono text-[12.5px] outline-none placeholder:text-muted-foreground"
      placeholder="Commit message"
      spellcheck="false"
    />
    <div class="flex items-center justify-end gap-2 border-t px-2 py-1.5">
      <Button
        size="sm"
        :disabled="commit.committing || !commit.message.trim()"
        @click="commit.commit()"
      >
        {{ commit.amend ? "Amend Commit" : "Commit" }}
      </Button>
    </div>
  </div>
</template>
