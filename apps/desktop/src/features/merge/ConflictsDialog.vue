<script setup lang="ts">
import { onMounted } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";
import { useConflictsStore } from "@/stores/conflictsStore";
import { useRewriteStore } from "@/stores/rewriteStore";

const conflicts = useConflictsStore();
const rewrite = useRewriteStore();

onMounted(() => {
  void conflicts.refresh();
  void rewrite.refreshOpState();
});

async function accept(side: "ours" | "theirs") {
  const paths = conflicts.selected.length
    ? conflicts.selected
    : conflicts.entries.map((e) => e.path);
  await conflicts.acceptSide(side, paths);
}

async function mergeSelected() {
  const path = conflicts.selected[0] ?? conflicts.entries[0]?.path;
  const entry = conflicts.entries.find((e) => e.path === path);
  if (!entry) return;
  await conflicts.openMerge(entry);
  closeDialog(true);
}

async function continueAfter() {
  closeDialog(true);
  await rewrite.continueOp();
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">{{ conflicts.list?.title || "Conflicts" }}</h2>
      <p class="mt-1 text-[11px] text-muted-foreground">
        Yours = {{ conflicts.list?.yoursLabel }} · Theirs = {{ conflicts.list?.theirsLabel }}
      </p>
      <div class="mt-3 min-h-0 flex-1 overflow-auto rounded border">
        <table class="w-full text-left text-xs">
          <thead class="sticky top-0 bg-muted">
            <tr>
              <th class="w-8 px-2 py-1" />
              <th class="px-2 py-1">File</th>
              <th class="px-2 py-1">Yours</th>
              <th class="px-2 py-1">Theirs</th>
              <th class="px-2 py-1">Type</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in conflicts.entries"
              :key="e.path"
              class="border-t hover:bg-accent/50"
              @dblclick="conflicts.openMerge(e); closeDialog(true)"
            >
              <td class="px-2 py-1">
                <input
                  type="checkbox"
                  :checked="conflicts.selected.includes(e.path)"
                  @change="conflicts.toggleSelect(e.path)"
                />
              </td>
              <td class="px-2 py-1 font-mono">{{ e.path }}</td>
              <td class="px-2 py-1">{{ e.yours }}</td>
              <td class="px-2 py-1">{{ e.theirs }}</td>
              <td class="px-2 py-1">{{ e.kind }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="!conflicts.entries.length" class="p-4 text-center text-xs text-muted-foreground">
          All conflicts resolved
        </div>
      </div>
      <div class="mt-4 flex flex-wrap justify-between gap-2">
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" :disabled="!conflicts.selected.length && !conflicts.entries.length" @click="accept('ours')">
            Accept Yours
          </Button>
          <Button size="sm" variant="outline" :disabled="!conflicts.selected.length && !conflicts.entries.length" @click="accept('theirs')">
            Accept Theirs
          </Button>
          <Button size="sm" variant="outline" @click="mergeSelected">Merge…</Button>
          <Button size="sm" variant="secondary" @click="conflicts.resolveSimple()">Resolve All Simple</Button>
        </div>
        <div class="flex gap-2">
          <Button
            v-if="!conflicts.entries.length && rewrite.opState && rewrite.opState.kind !== 'normal'"
            size="sm"
            @click="continueAfter"
          >
            {{ rewrite.opState.kind === 'merge' ? 'Commit Merge' : 'Continue' }}
          </Button>
          <Button variant="ghost" size="sm" @click="closeDialog(false)">Close</Button>
        </div>
      </div>
    </div>
  </div>
</template>
