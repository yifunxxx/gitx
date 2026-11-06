<script setup lang="ts">
import { ref } from "vue";
import { useCommitStore } from "@/stores/commitStore";
import { useLogStore } from "@/stores/logStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { Button } from "@/components/ui/button";
import { toast } from "@/composables/useToast";

const commit = useCommitStore();
const log = useLogStore();
const rewrite = useRewriteStore();
const amendTarget = ref("");

async function onAmendChange(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  await commit.setAmend(checked);
  if (!checked) amendTarget.value = "";
}

async function onAmendTargetChange() {
  if (!amendTarget.value) {
    await commit.setAmend(true);
    return;
  }
  // Early commit amend via fixup (#61 / #108).
  await commit.setAmend(false);
  try {
    await rewrite.fixupInto(amendTarget.value, false);
    toast({ title: "Fixed up into selected commit" });
    amendTarget.value = "";
  } catch (e: unknown) {
    toast({
      title: "Fixup failed",
      description: (e as { message?: string })?.message ?? String(e),
    });
  }
}

const recentLocal = () => log.commits.slice(0, 12);
</script>

<template>
  <div class="flex shrink-0 flex-col border-t bg-sidebar">
    <div class="flex flex-wrap items-center gap-3 border-b px-2 py-1.5 text-xs">
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
        Amend Commit…
        <select
          v-model="amendTarget"
          class="h-6 max-w-[10rem] rounded border bg-background px-1 text-[11px]"
          @change="onAmendTargetChange"
        >
          <option value="">HEAD</option>
          <option v-for="c in recentLocal()" :key="c.sha" :value="c.sha">
            {{ c.sha.slice(0, 7) }} {{ c.subject.slice(0, 32) }}
          </option>
        </select>
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
