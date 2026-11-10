<script setup lang="ts">
import { onMounted, ref } from "vue";
import VirtualList from "@/components/common/VirtualList.vue";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";
import { getBackend } from "@/lib/backend";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { CompareRange } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";

const props = defineProps<{ left: string; right: string }>();
const result = ref<CompareRange | null>(null);
const error = ref<string | null>(null);
const swapped = ref(false);

const left = ref(props.left);
const right = ref(props.right);

async function load() {
  const ws = useWorkspaceStore();
  if (!ws.repoPath) return;
  try {
    result.value = await getBackend().compareBranches({
      path: ws.repoPath,
      left: left.value,
      right: right.value,
    });
  } catch (e) {
    error.value = formatErrorMessage(e);
  }
}

function swap() {
  const t = left.value;
  left.value = right.value;
  right.value = t;
  swapped.value = !swapped.value;
  void load();
}

onMounted(() => void load());
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div
      class="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border bg-popover p-4 shadow-lg"
    >
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold">{{ left }} ↔ {{ right }}</h2>
        <div class="flex-1" />
        <Button size="xs" variant="outline" @click="swap">Swap</Button>
        <Button size="xs" variant="ghost" @click="closeDialog()">Close</Button>
      </div>
      <p v-if="error" class="mt-2 text-xs text-destructive">{{ error }}</p>
      <div v-else-if="result" class="mt-3 grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-hidden">
        <div class="flex h-80 min-h-0 flex-col rounded border p-2">
          <div class="mb-1 text-[11px] font-medium text-muted-foreground">
            In {{ right }} not in {{ left }}
          </div>
          <div v-if="!result.leftOnly.length" class="text-xs text-muted-foreground">
            No unique commits
          </div>
          <VirtualList
            :items="result.leftOnly"
            :item-height="22"
            :get-key="(_c, index) => index"
            class="font-mono text-[11px]"
            ><template #default="{ item: c }"
              ><div class="flex h-full min-w-0 items-center" :title="c">
                <span class="truncate">{{ c }}</span>
              </div></template
            ></VirtualList
          >
        </div>
        <div class="flex h-80 min-h-0 flex-col rounded border p-2">
          <div class="mb-1 text-[11px] font-medium text-muted-foreground">
            In {{ left }} not in {{ right }}
          </div>
          <div v-if="!result.rightOnly.length" class="text-xs text-muted-foreground">
            No unique commits
          </div>
          <VirtualList
            :items="result.rightOnly"
            :item-height="22"
            :get-key="(_c, index) => index"
            class="font-mono text-[11px]"
            ><template #default="{ item: c }"
              ><div class="flex h-full min-w-0 items-center" :title="c">
                <span class="truncate">{{ c }}</span>
              </div></template
            ></VirtualList
          >
        </div>
      </div>
    </div>
  </div>
</template>
