<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { getGroup, getAction, runAction, shortcutFor } from "@/actions";
import type { ActionContext } from "@/actions";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const open = ref(false);
const x = ref(0);
const y = ref(0);
const workspace = useWorkspaceStore();

const items = () =>
  (getGroup("Git.ContextMenu.Changes")?.children ?? [])
    .filter((c): c is string => c !== "-")
    .map((id) => getAction(id))
    .filter(Boolean);

function onContext(e: MouseEvent) {
  e.preventDefault();
  open.value = true;
  x.value = e.clientX;
  y.value = e.clientY;
}

function onClose() {
  open.value = false;
}

async function pick(id: string) {
  open.value = false;
  const ctx: ActionContext = {
    repoIds: workspace.toplevel ? [workspace.toplevel] : [],
    selection: {},
    source: "context",
    place: "Git.ContextMenu.Changes",
    folderPath: workspace.folderPath,
  };
  await runAction(id, ctx);
}

onMounted(() => {
  window.addEventListener("contextmenu", onContext);
  window.addEventListener("click", onClose);
});
onUnmounted(() => {
  window.removeEventListener("contextmenu", onContext);
  window.removeEventListener("click", onClose);
});
</script>

<template>
  <div
    v-if="open"
    class="fixed z-[9999] min-w-40 rounded-md border bg-popover p-1 shadow-lg ring-1 ring-foreground/10"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @click.stop
  >
    <button
      v-for="a in items()"
      :key="a!.id"
      type="button"
      class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] leading-4 hover:bg-accent"
      @click="pick(a!.id)"
    >
      <span>{{ a!.title }}</span>
      <kbd
        v-if="shortcutFor(a!)[0]"
        class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
      >
        {{ shortcutFor(a!)[0] }}
      </kbd>
    </button>
  </div>
</template>
