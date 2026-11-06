<script setup lang="ts">
import { getGroup, getAction, runAction, shortcutFor } from "@/actions";
import type { ActionContext } from "@/actions";
import { useLayoutStore } from "@/stores/layoutStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { computed } from "vue";

const layout = useLayoutStore();
const workspace = useWorkspaceStore();

const group = computed(() => getGroup("Vcs.Operations.Popup"));
const items = computed(() =>
  (group.value?.children ?? [])
    .filter((c): c is string => c !== "-")
    .map((id) => getAction(id))
    .filter(Boolean),
);

const ctx = computed<ActionContext>(() => ({
  repoIds: workspace.toplevel ? [workspace.toplevel] : [],
  selection: {},
  source: "popup",
  place: "Vcs.Operations.Popup",
  folderPath: workspace.folderPath,
}));

async function pick(id: string) {
  layout.vcsPopupOpen = false;
  await runAction(id, ctx.value);
}
</script>

<template>
  <div
    v-if="layout.vcsPopupOpen"
    class="fixed inset-0 z-[60] bg-black/30"
    @click.self="layout.vcsPopupOpen = false"
  >
    <div
      class="absolute left-10 top-12 min-w-56 rounded-md border bg-popover p-1 shadow-lg ring-1 ring-foreground/10"
    >
      <div class="px-2 py-1 text-[11px] font-medium text-muted-foreground">
        VCS Operations
      </div>
      <button
        v-for="a in items"
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
  </div>
</template>
